/**
 * A fake Index HTTP server that replays a synthetic chain, counting every row
 * it returns (what the real Index would meter). Shared by the reindex
 * over-fetch test and the local measurement harness, so both exercise the
 * real `IndexHttpClient` -> `PublicApiBlockSource` -> `reindexSubgraph` path
 * without touching any hosted API.
 *
 * The chain: every block carries `backgroundPrintsPerBlock` print events spread
 * over `backgroundContracts` unrelated contracts (the "every print on chain"
 * volume). The target contract prints with `otherTopic` every
 * `targetEvery` blocks, and with `wantedTopic` only at `wantedHeights`.
 *
 * Run standalone for a separate-process server (so a caller's RSS is its own):
 *   bun fake-index.ts '<json FakeIndexOptions>'
 * prints `READY <url>` then serves until killed; GET /__stats returns counters.
 */
import { Cl, serializeCV } from "@secondlayer/stacks/clarity";

export type FakeIndexOptions = {
	tip: number;
	backgroundPrintsPerBlock: number;
	backgroundContracts: number;
	targetContract: string;
	/** Target prints (with `otherTopic`) at every multiple of this height. */
	targetEvery: number;
	otherTopic: string;
	wantedTopic: string;
	/** Heights where the target prints `wantedTopic` (what a handler wants). */
	wantedHeights: number[];
	/** Bytes of filler per print payload, so rows weigh what real ones do. */
	payloadBytes?: number;
	port?: number;
};

export type FakeIndexStats = {
	/** Rows returned per route; the sum is what the real Index would bill. */
	rows: { blocks: number; events: number };
	requests: { blocks: number; events: number };
	/** One entry per events request: its contract_id param (or null). */
	eventRequests: { contractId: string | null; limit1: boolean }[];
};

const PAGE_MAX = 1000;

type EventKey = { height: number; index: number };

export function startFakeIndex(opts: FakeIndexOptions) {
	const filler = "x".repeat(opts.payloadBytes ?? 200);
	const hexCache = new Map<string, string>();
	const rawValue = (topic: string): string => {
		let hex = hexCache.get(topic);
		if (!hex) {
			hex = `0x${serializeCV(
				Cl.tuple({
					topic: Cl.stringAscii(topic),
					memo: Cl.stringAscii(filler),
				}),
			)}`;
			hexCache.set(topic, hex);
		}
		return hex;
	};
	const wanted = new Set(opts.wantedHeights);
	const stats: FakeIndexStats = {
		rows: { blocks: 0, events: 0 },
		requests: { blocks: 0, events: 0 },
		eventRequests: [],
	};

	const bgContract = (k: number) => `SP${k}.bg-${k}`;
	const targetPrints = (h: number): { topic: string }[] => {
		const out: { topic: string }[] = [];
		if (h % opts.targetEvery === 0) out.push({ topic: opts.otherTopic });
		if (wanted.has(h)) out.push({ topic: opts.wantedTopic });
		return out;
	};

	const eventRow = (
		h: number,
		index: number,
		contract: string,
		topic: string,
	) => ({
		event_type: "print",
		block_height: h,
		tx_id: `0x${h.toString(16)}${index.toString(16)}`,
		tx_index: 0,
		event_index: index,
		contract_id: contract,
		tx_sender: "SP000000000000000000002Q6VF78",
		tx_type: "contract_call",
		tx_status: "success",
		tx_contract_id: contract,
		tx_function_name: "emit",
		payload: { topic: "print", value: null, raw_value: rawValue(topic) },
	});

	/** Events at one height, honoring the contract filter. */
	function eventsAt(h: number, contracts: Set<string> | null) {
		const rows: ReturnType<typeof eventRow>[] = [];
		let index = 0;
		for (let k = 0; k < opts.backgroundPrintsPerBlock; k++, index++) {
			const c = bgContract(k % opts.backgroundContracts);
			if (!contracts || contracts.has(c)) {
				rows.push(eventRow(h, index, c, "bg-print"));
			}
		}
		for (const p of targetPrints(h)) {
			if (!contracts || contracts.has(opts.targetContract)) {
				rows.push(eventRow(h, index, opts.targetContract, p.topic));
			}
			index++;
		}
		return rows;
	}

	const tipEnvelope = {
		block_height: opts.tip,
		source_block_height: opts.tip,
		decoded_heights: { print: opts.tip },
	};

	function parseCursor(c: string): EventKey {
		const [h, i] = c.split(":");
		return { height: Number(h), index: Number(i) };
	}

	function handleEvents(q: URLSearchParams) {
		const contractParam = q.get("contract_id");
		const contracts = contractParam ? new Set(contractParam.split(",")) : null;
		const limit = Math.min(Number(q.get("limit") ?? PAGE_MAX), PAGE_MAX);
		const to = Math.min(Number(q.get("to_height") ?? opts.tip), opts.tip);
		const after = q.get("cursor")
			? parseCursor(q.get("cursor") as string)
			: null;
		const from = after ? after.height : Number(q.get("from_height") ?? 1);
		stats.requests.events++;
		stats.eventRequests.push({
			contractId: contractParam,
			limit1: limit === 1,
		});

		const items: ReturnType<typeof eventRow>[] = [];
		let next: string | null = null;
		const scopedToTarget =
			contracts !== null &&
			contracts.size === 1 &&
			contracts.has(opts.targetContract);
		for (let h = Math.max(from, 1); h <= to && items.length < limit; h++) {
			// Scoped to the target: skip the (vast) background heights outright.
			if (scopedToTarget && targetPrints(h).length === 0) continue;
			for (const row of eventsAt(h, contracts)) {
				if (after && h === after.height && row.event_index <= after.index) {
					continue;
				}
				items.push(row);
				if (items.length === limit) break;
			}
		}
		const last = items[items.length - 1];
		// A full page may have more behind it; an empty follow-up page is fine.
		if (last && items.length === limit) {
			next = `${last.block_height}:${last.event_index}`;
		}
		stats.rows.events += items.length;
		return { events: items, next_cursor: next, tip: tipEnvelope, reorgs: [] };
	}

	function handleBlocks(q: URLSearchParams) {
		stats.requests.blocks++;
		if (q.get("tip_only") === "true") {
			return { blocks: [], next_cursor: null, tip: tipEnvelope, reorgs: [] };
		}
		const limit = Math.min(Number(q.get("limit") ?? PAGE_MAX), PAGE_MAX);
		const to = Math.min(Number(q.get("to_height") ?? opts.tip), opts.tip);
		const from = q.get("cursor")
			? Number(q.get("cursor")) + 1
			: Number(q.get("from_height") ?? 1);
		const blocks = [];
		for (let h = Math.max(from, 1); h <= to && blocks.length < limit; h++) {
			blocks.push({
				block_height: h,
				block_hash: `0xb${h}`,
				parent_hash: `0xb${h - 1}`,
				burn_block_height: h,
				burn_block_hash: null,
				index_block_hash: null,
				block_time: new Date(1_700_000_000_000 + h * 1000).toISOString(),
			});
		}
		const last = blocks[blocks.length - 1];
		const more = last !== undefined && last.block_height < to;
		stats.rows.blocks += blocks.length;
		return {
			blocks,
			next_cursor: more ? String(last?.block_height) : null,
			tip: tipEnvelope,
			reorgs: [],
		};
	}

	const server = Bun.serve({
		port: opts.port ?? 0,
		fetch(req) {
			const url = new URL(req.url);
			if (url.pathname === "/__stats") return Response.json(stats);
			if (url.pathname === "/v1/index/events") {
				return Response.json(handleEvents(url.searchParams));
			}
			if (url.pathname === "/v1/index/blocks") {
				return Response.json(handleBlocks(url.searchParams));
			}
			return new Response("not found", { status: 404 });
		},
	});

	return {
		url: `http://127.0.0.1:${server.port}`,
		stats,
		stop: () => server.stop(true),
	};
}

if (import.meta.main) {
	const opts = JSON.parse(process.argv[2] ?? "{}") as FakeIndexOptions;
	const server = startFakeIndex(opts);
	console.log(`READY ${server.url}`);
}
