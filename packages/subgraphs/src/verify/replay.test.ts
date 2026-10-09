import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitTransactions } from "@secondlayer/stacks/transactions";
import { txidFromBytes } from "@secondlayer/stacks/utils";
import {
	type BlockVerification,
	type StateWrite,
	parseNakamotoHeader,
	unhex,
} from "@secondlayer/verify";
import { generateSubgraphSQL } from "../schema/generator.ts";
import { pinPreimage } from "../verification.ts";
import { compareRows } from "./compare.ts";
import { type ReplayDeps, checkPin, replayBlocks } from "./replay.ts";

/**
 * Replay over an injected verifier: every block "verifies", carrying two real
 * mainnet transactions (block 8,199,502's) and the writes a test names.
 */

const POOL = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-vault-v2-01";
const uintHex = (n: bigint) => `01${n.toString(16).padStart(32, "0")}`;
const stored = (s: string) => Buffer.from(s, "utf8").toString("hex");

const MAINNET_TXS = (() => {
	const raw = unhex(
		readFileSync(
			join(import.meta.dir, "../../../verify/test/fixtures/blocks/8199502.hex"),
			"utf8",
		).trim(),
	);
	const body = raw.subarray(parseNakamotoHeader(raw).byteLength);
	return splitTransactions(body.subarray(4), 2).map((t) => ({
		txid: txidFromBytes(t),
		raw: t,
	}));
})();

type Write = { key: bigint; value: bigint | null; tx?: number | null };

function writes(list: Write[]): StateWrite[] {
	return list.map((w, ordinal) => ({
		ordinal,
		tx_index: w.tx === undefined ? 0 : w.tx,
		key: `vm::${POOL}::0::reserve::${uintHex(w.key)}`,
		value_hex: stored(w.value === null ? "09" : `0a${uintHex(w.value)}`),
	}));
}

function verified(height: number, w: StateWrite[]): BlockVerification {
	const id = createHash("sha256").update(`block ${height}`).digest("hex");
	return {
		ok: true,
		height,
		blockId: id,
		blockHash: id.split("").reverse().join(""),
		consensusHash: "ab".repeat(20),
		timestamp: 1_700_000_000 + height,
		burnHeight: 900_000,
		transactions: MAINNET_TXS,
		diff: { named: true, writes: [], carried: [], internal: [] },
		writes: w,
		notes: [],
		failures: [],
	};
}

/** Bundled-handler shape, as esbuild emits it into `handler_code`. */
function bundle(handlerBody: string, extraTable = "") {
	return `
var subgraph_default = {
	name: "pool-reserves",
	startBlock: 100,
	sources: { reserve: { type: "map_set", contractId: "${POOL}", map: "reserve" } },
	schema: {
		reserves: {
			columns: { token: { type: "principal" }, amount: { type: "uint" } },
			uniqueKeys: [["token"]],
		},
		log: { columns: { amount: { type: "uint" } } },
		${extraTable}
	},
	handlers: { reserve: (event, ctx) => { ${handlerBody} } },
};
export { subgraph_default as default };
`;
}

const UPSERT =
	'ctx.upsert("reserves", { token: String(event.key) }, { amount: event.value });';
const LOG = 'ctx.insert("log", { amount: event.value });';

const CHAIN: Record<number, Write[]> = {
	100: [{ key: 1n, value: 10n }],
	101: [
		{ key: 2n, value: 7n, tx: 1 },
		{ key: 1n, value: 12n, tx: 1 },
	],
	102: [],
	103: [
		{ key: 1n, value: 12n },
		{ key: 3n, value: 1n, tx: null },
	],
};

function deps(
	over: Partial<Record<number, BlockVerification>> = {},
): ReplayDeps {
	return {
		verify: async (h) => over[h] ?? verified(h, writes(CHAIN[h] ?? [])),
		burnHeightHint: async () => 899_000,
	};
}

const replay = (
	handler: string,
	opts: { from?: number; to?: number; d?: ReplayDeps } = {},
) =>
	replayBlocks(opts.d ?? deps(), {
		handlerCode: bundle(handler),
		from: opts.from ?? 100,
		to: opts.to ?? 103,
	});

/** What Postgres would serve for the replayed tables: strings, _id, _created_at. */
function served(
	tables: Map<string, Record<string, unknown>[]>,
): Map<string, Record<string, unknown>[]> {
	let id = 0;
	return new Map(
		[...tables].map(([t, rows]) => [
			t,
			rows.map((r) => ({
				...Object.fromEntries(
					Object.entries(r).map(([k, v]) => [
						k,
						typeof v === "bigint" ? v.toString() : v,
					]),
				),
				_id: String(++id),
				_created_at: new Date(),
			})),
		]),
	);
}

const SCHEMA = {
	reserves: {
		columns: {
			token: { type: "principal" as const },
			amount: { type: "uint" as const },
		},
		uniqueKeys: [["token"]],
	},
	log: { columns: { amount: { type: "uint" as const } } },
};

describe("replay over proven blocks", () => {
	test("a clean range replays and every served row compares equal", async () => {
		const r = await replay(`${UPSERT} ${LOG}`);
		expect(r.failures).toEqual([]);
		expect(r).toMatchObject({
			ok: true,
			blocks: 4,
			txs: 8,
			writes: 5,
			events: 5,
			handlerErrors: 0,
		});
		expect(r.tables.get("reserves")).toEqual([
			{
				token: "1",
				amount: 12n,
				_block_height: 100,
				_tx_id: `0x${MAINNET_TXS[0]?.txid}`,
			},
			{
				token: "2",
				amount: 7n,
				_block_height: 101,
				_tx_id: `0x${MAINNET_TXS[1]?.txid}`,
			},
			// A block-level write hangs on the synthetic tx with an empty id.
			{ token: "3", amount: 1n, _block_height: 103, _tx_id: "" },
		]);
		const cmp = compareRows(SCHEMA, r, served(r.tables));
		expect(cmp.failures).toEqual([]);
		expect(cmp.tables.map((t) => [t.table, t.equal])).toEqual([
			["reserves", 3],
			["log", 5],
		]);
		for (const t of cmp.tables) expect(t.digest).toBe(t.servedDigest);
	});

	test("ctx.block carries the verified header: hash, id, timestamp, burn height", async () => {
		const r = await replay(
			'ctx.insert("log", { amount: BigInt(ctx.block.timestamp) + BigInt(ctx.block.burnBlockHeight) });',
			{ to: 100 },
		);
		expect(r.tables.get("log")?.[0]?.amount).toBe(1_700_000_100n + 900_000n);
	});

	test("a tampered served row is the first broken link: rows", async () => {
		const r = await replay(UPSERT);
		const s = served(r.tables);
		const row = s.get("reserves")?.[0] as Record<string, unknown>;
		row.amount = "13";
		const cmp = compareRows(SCHEMA, r, s);
		expect(cmp.failures[0]).toMatchObject({
			step: "rows",
			table: "reserves",
			message: 'reserves ["1"]: amount served 13, replayed 12',
			key: { token: "1" },
		});
		expect(cmp.tables[0]?.digest).not.toBe(cmp.tables[0]?.servedDigest);
	});

	test("a served row no proven input produces is an extra: rows", async () => {
		const r = await replay(UPSERT);
		const s = served(r.tables);
		s.get("reserves")?.push({
			token: "9",
			amount: "1",
			_block_height: "102",
			_tx_id: "0xforged",
		});
		expect(compareRows(SCHEMA, r, s).failures[0]?.message).toBe(
			'reserves ["9"]: extra: no proven input produces it',
		);
	});

	test("a replayed row the server re-created after --to is superseded, not checked", async () => {
		const r = await replay(UPSERT, { to: 101 });
		const s = served(r.tables);
		const row = s.get("reserves")?.[1] as Record<string, unknown>;
		row._block_height = "500";
		row.amount = "999";
		const cmp = compareRows(SCHEMA, r, s);
		expect(cmp.failures).toEqual([]);
		expect(cmp.tables[0]).toMatchObject({ equal: 1, superseded: 1 });
	});

	test("a dropped write fails the names check: inputs", async () => {
		const broken = verified(101, writes(CHAIN[101] ?? []));
		broken.ok = false;
		broken.failures = [
			{
				step: "names",
				code: "hidden-write",
				message:
					"leaf 9f… is not a named write, a carried parent value or MARF bookkeeping",
			},
		];
		const r = await replay(UPSERT, { d: deps({ 101: broken }) });
		expect(r.ok).toBe(false);
		expect(r.failures[0]).toMatchObject({ step: "inputs", height: 101 });
		expect(r.failures[0]?.message).toStartWith("block 101: leaf");
	});

	test("transactions that miss the tx merkle root: txs", async () => {
		const broken = verified(102, []);
		broken.ok = false;
		broken.failures = [
			{
				step: "txs",
				code: "tx-root-mismatch",
				message: "transactions hash to …",
			},
		];
		const r = await replay(UPSERT, { d: deps({ 102: broken }) });
		expect(r.failures[0]).toMatchObject({ step: "txs", height: 102 });
	});

	test("a header the source could not serve is unchecked, not disproven", async () => {
		const broken = verified(103, []);
		broken.ok = false;
		broken.failures = [
			{ step: "witness", code: "unavailable", message: "witness: HTTP 503" },
		];
		const r = await replay(UPSERT, { d: deps({ 103: broken }) });
		expect(r.failures[0]).toMatchObject({ step: "blocks", unavailable: true });
	});

	test("a block whose writes the source cannot name is not replayable: inputs", async () => {
		const unnamed = verified(100, []);
		unnamed.diff = { named: false, writes: [], carried: [], internal: [] };
		unnamed.writes = undefined;
		const r = await replay(UPSERT, { d: deps({ 100: unnamed }) });
		expect(r.failures[0]).toMatchObject({ step: "inputs", unavailable: true });
	});

	test("Date.now() in the handler breaks the handlers link", async () => {
		const r = await replay(
			'ctx.insert("log", { amount: BigInt(Date.now()) });',
		);
		expect(r.failures[0]).toMatchObject({ step: "handlers", height: 100 });
		expect(r.failures[0]?.message).toContain("NondeterminismError");
	});

	test("an events-level definition is refused before any block is read", async () => {
		let reads = 0;
		const r = await replayBlocks(
			{
				verify: async (h) => {
					reads++;
					return verified(h, []);
				},
				burnHeightHint: async () => 0,
			},
			{
				handlerCode: bundle(UPSERT).replace(
					'type: "map_set"',
					'type: "map_insert"',
				),
				from: 100,
				to: 101,
			},
		);
		expect(r.failures[0]?.step).toBe("handlers");
		expect(r.failures[0]?.message).toContain("level events");
		expect(reads).toBe(0);
	});

	test("from after startBlock: an increment is inconclusive, a full upsert is not", async () => {
		const inc = await replay(
			'ctx.increment("reserves", { token: String(event.key) }, { amount: 1n });',
			{ from: 101 },
		);
		expect(inc.ok).toBe(false);
		expect(inc.inconclusive).toContain('increment("reserves")');

		const upsert = await replay(UPSERT, { from: 101 });
		expect(upsert.inconclusive).toBeUndefined();
		expect(upsert.ok).toBe(true);
		// Token 1 was first written at 100, before the window: the server keeps
		// that row's _block_height; its columns still compare.
		const full = await replay(UPSERT);
		const cmp = compareRows(SCHEMA, upsert, served(full.tables));
		expect(cmp.failures).toEqual([]);
	});

	test("unkeyed tables compare as multisets: duplicates count", async () => {
		const r = await replay(LOG, { to: 103 });
		const s = served(r.tables);
		// Blocks 101 and 103 both write 12: drop one of the two equal rows.
		const log = s.get("log") as Record<string, unknown>[];
		const dupes = log.filter((x) => x.amount === "12");
		expect(dupes.length).toBe(2);
		s.set(
			"log",
			log.filter((x) => x !== dupes[1]),
		);
		const cmp = compareRows(SCHEMA, r, s);
		expect(cmp.failures[0]?.message).toContain("replayed but not served");
	});
});

describe("checkPin", () => {
	const code = bundle(UPSERT);
	const def = {
		name: "pool-reserves",
		startBlock: 100,
		sources: { reserve: { type: "map_set", contractId: POOL, map: "reserve" } },
		schema: SCHEMA,
		handlers: {},
	} as never;
	const preimage = pinPreimage({
		schemaHash: generateSubgraphSQL(def).hash,
		handlerCode: code,
		startBlock: 100,
		network: "mainnet",
	});
	const pin = createHash("sha256").update(preimage).digest("hex");

	test("the served preimage hashes to the pin and names this bundle, schema and startBlock", () => {
		expect(
			checkPin({ pin, pinPreimage: preimage, handlerCode: code }, def),
		).toEqual({
			status: "ok",
			notes: [],
		});
	});

	test("deployed before preimages were stored: unchecked", () => {
		expect(
			checkPin({ pin, pinPreimage: null, handlerCode: code }, def).status,
		).toBe("unchecked");
	});

	test("another bundle under the same pin fails", () => {
		const r = checkPin(
			{ pin, pinPreimage: preimage, handlerCode: `${code}\n` },
			def,
		);
		expect(r.status).toBe("failed");
	});

	test("a preimage that does not hash to the pin fails", () => {
		const r = checkPin(
			{ pin: "00".repeat(32), pinPreimage: preimage, handlerCode: code },
			def,
		);
		expect(r).toMatchObject({
			status: "failed",
			failure: { step: "pin" },
		});
	});

	test("a different runtime is a note, not a failure", () => {
		const other = JSON.stringify({
			...JSON.parse(preimage),
			runtime: "@secondlayer/subgraphs@1.0.0",
		});
		const r = checkPin(
			{
				pin: createHash("sha256").update(other).digest("hex"),
				pinPreimage: other,
				handlerCode: code,
			},
			def,
		);
		expect(r.status).toBe("ok");
		expect(r.notes[0]).toContain("deployed on @secondlayer/subgraphs@1.0.0");
	});
});
