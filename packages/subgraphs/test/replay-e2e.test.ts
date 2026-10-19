import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, getSourceDb, sql } from "@secondlayer/shared/db";
import { decodeRawTx } from "@secondlayer/shared/node/tx-summary";
import { hex, marfPath } from "@secondlayer/verify";
import { processBlock } from "../src/runtime/block-processor.ts";
import {
	dbStateWritesCoverage,
	stateWriteFeed,
} from "../src/runtime/block-source.ts";
import { loadDeterministicDefinition } from "../src/runtime/realm.ts";
import { deploySchema } from "../src/schema/deployer.ts";
import { pgSchemaName } from "../src/schema/utils.ts";
import type { SubgraphDefinition } from "../src/types.ts";
import { deriveVerification } from "../src/verification.ts";
import { compareRows } from "../src/verify/compare.ts";
import { type ReplayResult, replaySubgraph } from "../src/verify/replay.ts";
import {
	FROM,
	FakeProofSource,
	POOL,
	TO,
	WKIKI,
	decodeReserveWrite,
	recordedWindow,
} from "./replay-fixture.ts";

/**
 * End to end over the recorded mainnet window (see replay-fixture.ts):
 * replay verifies every block from `MAINNET_CHECKPOINT` with the recorded
 * proofs, feeds the named writes to the handler and must agree with the
 * server path (state_writes in Postgres → PostgresBlockSource feed →
 * processBlock in the realm → flush). Each kind of lie breaks its own link.
 */

const NAME = "pool-reserves-replay-e2e";

const handlerCode = (body: string) => `
var subgraph_default = {
	name: "${NAME}",
	startBlock: ${FROM},
	sources: { reserve: { type: "map_set", contractId: "${POOL}", map: "reserve" } },
	schema: {
		reserves: {
			columns: { token: { type: "principal" }, amount: { type: "uint" } },
			uniqueKeys: [["token"]],
		},
	},
	handlers: { reserve: (event, ctx) => { ${body} } },
};
export { subgraph_default as default };
`;
const CLEAN = handlerCode(
	'ctx.upsert("reserves", { token: event.key }, { amount: event.value });',
);

const WINDOW = recordedWindow();
/** The window's only vault write: reserve[token-wkiki], ordinal 5 of 1,230,200. */
const VAULT_WRITES = WINDOW.flatMap((b) =>
	b.writes
		.filter((w) => w.key.startsWith(`vm::${POOL}::0::reserve::`))
		.map((w) => ({ height: b.height, write: w })),
);
const WKIKI_WRITE = VAULT_WRITES[0] as (typeof VAULT_WRITES)[number];
const WKIKI_HEIGHT = 1_230_200;
const WKIKI_RESERVE = decodeReserveWrite(WKIKI_WRITE.write);
const WKIKI_AMOUNT = WKIKI_RESERVE.amount;

const replay = (code: string, source = new FakeProofSource()) =>
	replaySubgraph({ source, handlerCode: code, from: FROM, to: TO });

test("the recording holds one vault write: reserve[token-wkiki] at ordinal 5 of 1,230,200", () => {
	expect(VAULT_WRITES).toHaveLength(1);
	expect(WKIKI_WRITE.height).toBe(WKIKI_HEIGHT);
	expect(WKIKI_WRITE.write.ordinal).toBe(5);
	expect(WKIKI_RESERVE.token).toBe(WKIKI);
});

describe("replay verifies the recorded window from the checkpoint", () => {
	let clean: ReplayResult;
	beforeAll(async () => {
		clean = await replay(CLEAN);
	});

	test("clean: every block verifies and reserve[wkiki] lands at 1,230,200 with the recorded amount", () => {
		expect(clean.failures).toEqual([]);
		expect(clean.ok).toBe(true);
		expect(clean.blocks).toBe(TO - FROM + 1);
		expect(clean.txs).toBe(WINDOW.reduce((n, b) => n + b.txs.length, 0));
		// Only the vault's writes reach the handler: the rest is noise.
		expect(clean.writes).toBe(VAULT_WRITES.length);
		expect(clean.events).toBe(VAULT_WRITES.length);
		expect(clean.tables.get("reserves")).toEqual([
			{
				token: WKIKI,
				amount: WKIKI_AMOUNT,
				_block_height: WKIKI_HEIGHT,
				_tx_id: `0x${WINDOW.find((b) => b.height === WKIKI_HEIGHT)?.txs[WKIKI_WRITE.write.tx_index as number]?.txid}`,
			},
		]);
	});

	test("a source that drops the ordinal-5 write breaks the inputs link (hidden-write)", async () => {
		const lying = new FakeProofSource();
		const named = lying.getStateWrites;
		lying.getStateWrites = async (h) =>
			(await named(h))?.filter(
				(w) => !(h === WKIKI_HEIGHT && w.ordinal === WKIKI_WRITE.write.ordinal),
			) ?? null;
		const r = await replay(CLEAN, lying);
		expect(r.ok).toBe(false);
		expect(r.failures[0]).toMatchObject({
			step: "inputs",
			height: WKIKI_HEIGHT,
		});
		expect(r.failures[0]?.unavailable).toBeUndefined();
		expect(r.failures[0]?.message).toContain(
			`leaf ${hex(marfPath(WKIKI_WRITE.write.key))} is not a named write`,
		);
	});

	test("the same definition with Date.now() in the handler breaks the handlers link", async () => {
		const r = await replay(
			handlerCode(
				'ctx.upsert("reserves", { token: event.key }, { amount: BigInt(Date.now()) });',
			),
		);
		expect(r.failures[0]).toMatchObject({
			step: "handlers",
			height: WKIKI_HEIGHT,
		});
		expect(r.failures[0]?.message).toContain("NondeterminismError");
	});
});

describe.skipIf(!process.env.DATABASE_URL)(
	"the served subgraph agrees with replay over the window",
	() => {
		const source = getSourceDb();
		const db = getDb();
		let served: Map<string, Record<string, unknown>[]>;
		let def: SubgraphDefinition;
		let replayed: ReplayResult;

		async function cleanup() {
			const heights = WINDOW.map((b) => b.height);
			await source
				.deleteFrom("state_writes")
				.where("block_height", "in", heights)
				.execute();
			await source
				.deleteFrom("transactions")
				.where("block_height", "in", heights)
				.execute();
			await source
				.deleteFrom("blocks")
				.where("height", "in", heights)
				.execute();
			await db.deleteFrom("subgraphs").where("name", "=", NAME).execute();
			await sql
				.raw(`DROP SCHEMA IF EXISTS "${pgSchemaName(NAME)}" CASCADE`)
				.execute(db);
		}

		beforeAll(async () => {
			await cleanup();
			for (const b of WINDOW) {
				await source
					.insertInto("blocks")
					.values({
						height: b.height,
						hash: `0x${b.blockHash}`,
						parent_hash: `0x${b.parentHash}`,
						burn_block_height: b.burnHeight,
						index_block_hash: `0x${b.blockId}`,
						timestamp: b.timestamp,
					})
					.execute();
				await source
					.insertInto("transactions")
					.values(
						b.txs.map((t, i) => {
							const d = decodeRawTx(hex(t.raw), t.txid);
							return {
								tx_id: `0x${t.txid}`,
								block_height: b.height,
								tx_index: i,
								type: d?.txType ?? "unknown",
								sender: d?.sender ?? "unknown",
								status: "success",
								contract_id: d?.contractId ?? null,
								function_name: d?.functionName ?? null,
								raw_tx: `0x${hex(t.raw)}`,
							};
						}),
					)
					.execute();
				await source
					.insertInto("state_writes")
					.values(b.writes.map((w) => ({ ...w, block_height: b.height })))
					.execute();
			}

			def = await loadDeterministicDefinition(CLEAN);
			// The instance now holds state_writes from FROM: the server switches feed.
			dbStateWritesCoverage.forget();
			expect(await stateWriteFeed(def)).toEqual({ contracts: [POOL] });
			await deploySchema(db, def, "/tmp/pool-reserves.ts", {
				handlerCode: CLEAN,
				verification: deriveVerification(def),
				network: "mainnet",
			});
			for (let h = FROM; h <= TO; h++) {
				const r = await processBlock(def, NAME, h);
				expect(r.errors).toBe(0);
			}
			const { rows } = await sql
				.raw(`SELECT * FROM "${pgSchemaName(NAME)}"."reserves" ORDER BY "_id"`)
				.execute(db);
			served = new Map([["reserves", rows as Record<string, unknown>[]]]);
			replayed = await replay(CLEAN);
		});

		afterAll(cleanup);

		test("clean: the replayed table equals the served one; reserve[wkiki] is served at 1,230,200", () => {
			expect(replayed.ok).toBe(true);
			const cmp = compareRows(def.schema, replayed, served);
			expect(cmp.failures).toEqual([]);
			expect(cmp.tables[0]?.equal).toBe(1);
			expect(cmp.tables[0]?.digest).toBe(cmp.tables[0]?.servedDigest);
			const wkiki = served.get("reserves")?.find((row) => row.token === WKIKI);
			expect(wkiki).toMatchObject({ amount: WKIKI_AMOUNT.toString() });
			expect(Number(wkiki?._block_height)).toBe(WKIKI_HEIGHT);
		});

		test("a tampered served amount breaks the rows link", () => {
			const tampered = new Map(
				[...served].map(([t, rows]) => [t, rows.map((row) => ({ ...row }))]),
			);
			const row = tampered.get("reserves")?.[0] as Record<string, unknown>;
			row.amount = "1";
			const cmp = compareRows(def.schema, replayed, tampered);
			expect(cmp.failures[0]).toMatchObject({
				step: "rows",
				table: "reserves",
			});
			expect(cmp.failures[0]?.message).toContain(
				`amount served 1, replayed ${WKIKI_AMOUNT}`,
			);
		});
	},
);
