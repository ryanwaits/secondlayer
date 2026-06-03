/**
 * Golden-diff parity check for the BlockSource re-point.
 *
 * Loads the SAME height range through `PostgresBlockSource` (DB tap) and
 * `PublicApiBlockSource` (public Index API), runs both through the real
 * matcher + handler-payload builder, and asserts byte-identical handler inputs
 * (which determine handler output rows). Any diff = the HTTP path would write
 * different rows.
 *
 * Run in-cluster against a populated DB + API:
 *   bun run packages/subgraphs/test/golden-diff.ts --from H1 --to H2 \
 *     [--base-url http://api:3800]
 */
import { readFileSync } from "node:fs";
import { IndexHttpClient } from "@secondlayer/shared/index-http";
import type { BlockData } from "../src/runtime/batch-loader.ts";
import {
	PostgresBlockSource,
	PublicApiBlockSource,
} from "../src/runtime/block-source.ts";
import { buildEventPayload } from "../src/runtime/runner.ts";
import { matchSources } from "../src/runtime/source-matcher.ts";
import type { SubgraphFilter } from "../src/types.ts";

/** Load the DB-tap ground truth from a capture-fixtures.ts JSON dump. */
function loadFixture(path: string): Map<number, BlockData> {
	const parsed = JSON.parse(readFileSync(path, "utf8")) as {
		blocks: {
			height: number;
			block: unknown;
			txs: unknown[];
			events: unknown[];
		}[];
	};
	const map = new Map<number, BlockData>();
	for (const b of parsed.blocks) {
		map.set(b.height, {
			block: b.block,
			txs: b.txs,
			events: b.events,
		} as BlockData);
	}
	return map;
}

function arg(name: string, def?: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : def;
}

// One source per event type, covering the Phase-1 surface.
const SOURCES: Record<string, SubgraphFilter> = {
	stxTransfer: { type: "stx_transfer" } as SubgraphFilter,
	stxMint: { type: "stx_mint" } as SubgraphFilter,
	ftTransfer: { type: "ft_transfer" } as SubgraphFilter,
	ftMint: { type: "ft_mint" } as SubgraphFilter,
	nftMint: { type: "nft_mint" } as SubgraphFilter,
	prints: { type: "print_event" } as SubgraphFilter,
};
const EVENT_TYPES = [
	"stx_transfer",
	"stx_mint",
	"ft_transfer",
	"ft_mint",
	"nft_mint",
	"print",
];

function stable(value: unknown): string {
	return JSON.stringify(value, (_k, v) =>
		typeof v === "bigint" ? `${v}n` : v,
	);
}

/** Map<key, serialized handler payload> across the whole range. */
function collectPayloads(blocks: Map<number, BlockData>): Map<string, string> {
	const out = new Map<string, string>();
	const noTraits = new Map<string, ReadonlySet<string>>();
	for (const [height, bd] of blocks) {
		const matched = matchSources(SOURCES, bd.txs, bd.events, noTraits);
		for (const m of matched) {
			const filter = SOURCES[m.sourceName];
			for (const ev of m.events) {
				const payload = buildEventPayload(filter, m.tx, ev);
				out.set(
					`${height}:${m.tx.tx_id}:${ev.event_index}:${m.sourceName}`,
					stable(payload),
				);
			}
		}
	}
	return out;
}

async function main(): Promise<void> {
	const from = Number(arg("from"));
	const to = Number(arg("to"));
	const baseUrl = arg("base-url", "http://api:3800") as string;
	if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
		console.error("usage: bun golden-diff.ts --from H1 --to H2 [--base-url]");
		process.exit(1);
	}

	const fixturePath = arg("fixture");
	const http = new PublicApiBlockSource(
		new IndexHttpClient({
			indexBaseUrl: baseUrl,
			indexApiKey: "", // anon read against the public API
			streamsBaseUrl: baseUrl,
			streamsApiKey: "",
		}),
		EVENT_TYPES,
	);

	// DB side: live Postgres tap, or a pre-captured fixture (same data, no DB
	// needed). API side: the live public Index API.
	const [dbBlocks, apiBlocks] = await Promise.all([
		fixturePath
			? Promise.resolve(loadFixture(fixturePath))
			: new PostgresBlockSource().loadBlockRange(from, to),
		http.loadBlockRange(from, to),
	]);

	const dbPayloads = collectPayloads(dbBlocks);
	const apiPayloads = collectPayloads(apiBlocks);

	const keys = new Set([...dbPayloads.keys(), ...apiPayloads.keys()]);
	const diffs: string[] = [];
	for (const k of keys) {
		const a = dbPayloads.get(k);
		const b = apiPayloads.get(k);
		if (a !== b) diffs.push(`  ${k}\n    db : ${a}\n    api: ${b}`);
	}

	console.log(
		JSON.stringify({
			from,
			to,
			dbBlocks: dbBlocks.size,
			apiBlocks: apiBlocks.size,
			dbPayloads: dbPayloads.size,
			apiPayloads: apiPayloads.size,
			diffs: diffs.length,
		}),
	);
	if (diffs.length > 0) {
		console.log("DIFFS (first 20):");
		console.log(diffs.slice(0, 20).join("\n"));
		process.exit(1);
	}
	console.log("✓ GOLDEN-DIFF PARITY: db == api");
}

void main();
