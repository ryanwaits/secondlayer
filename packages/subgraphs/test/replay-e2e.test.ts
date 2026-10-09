import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, getSourceDb, sql } from "@secondlayer/shared/db";
import { decodeRawTx } from "@secondlayer/shared/node/tx-summary";
import { hex } from "@secondlayer/verify";
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
import { type ReplayDeps, replayBlocks } from "../src/verify/replay.ts";
import {
	FROM,
	type FixtureBlock,
	POOL,
	TO,
	WKIKI_HEIGHT,
	WKIKI_ORDINAL,
	syntheticWindow,
	tokenKey,
	verifyFixtureBlock,
} from "./replay-fixture.ts";

/**
 * End to end over the 11-block window: the server path (state_writes in
 * Postgres → PostgresBlockSource feed → processBlock in the realm → flush)
 * and replay (verified blocks → stateWriteEvents → memory store) must agree,
 * and each kind of lie must break its own link. The window is SYNTHETIC until
 * the mainnet recording lands; see replay-fixture.ts.
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

const WINDOW = syntheticWindow();
const byHeight = new Map(WINDOW.map((b) => [b.height, b]));

/** A verifier over the fixture; `serve` decides which writes the source names. */
function fixtureDeps(
	serve: (b: FixtureBlock) => FixtureBlock["writes"] = (b) => b.writes,
): ReplayDeps {
	return {
		verify: async (h) => {
			const b = byHeight.get(h) as FixtureBlock;
			return verifyFixtureBlock(b, serve(b));
		},
		burnHeightHint: async () => 0,
	};
}

describe.skipIf(!process.env.DATABASE_URL)(
	"replay agrees with the served subgraph over the window, and catches each lie",
	() => {
		const source = getSourceDb();
		const db = getDb();
		let served: Map<string, Record<string, unknown>[]>;
		let def: SubgraphDefinition;

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
						parent_hash: "0x00",
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
		});

		afterAll(cleanup);

		test("clean: the replayed table equals the served one; reserve[wkiki] lands at 1,230,200", async () => {
			const r = await replayBlocks(fixtureDeps(), {
				handlerCode: CLEAN,
				from: FROM,
				to: TO,
			});
			expect(r.failures).toEqual([]);
			expect(r.ok).toBe(true);
			const cmp = compareRows(def.schema, r, served);
			expect(cmp.failures).toEqual([]);
			expect(cmp.tables[0]?.digest).toBe(cmp.tables[0]?.servedDigest);
			const wkiki = served
				.get("reserves")
				?.find((row) => String(row.token).endsWith(".token-wkiki"));
			expect(wkiki).toMatchObject({ amount: "4200000" });
			expect(Number(wkiki?._block_height)).toBe(WKIKI_HEIGHT);
			// Only the vault's reserve writes reach the handler: noise is dropped.
			expect(r.writes).toBe(
				WINDOW.flatMap((b) => b.writes).filter((w) =>
					w.key.startsWith(`vm::${POOL}::`),
				).length,
			);
		});

		test("a tampered served amount breaks the rows link", async () => {
			const r = await replayBlocks(fixtureDeps(), {
				handlerCode: CLEAN,
				from: FROM,
				to: TO,
			});
			const tampered = new Map(
				[...served].map(([t, rows]) => [t, rows.map((row) => ({ ...row }))]),
			);
			const row = tampered.get("reserves")?.[0] as Record<string, unknown>;
			row.amount = "1";
			const cmp = compareRows(def.schema, r, tampered);
			expect(cmp.failures[0]).toMatchObject({
				step: "rows",
				table: "reserves",
			});
			expect(cmp.failures[0]?.message).toContain("amount served 1, replayed");
		});

		test("a source that drops the ordinal-19 write breaks the inputs link (hidden-write)", async () => {
			const r = await replayBlocks(
				fixtureDeps((b) =>
					b.height === WKIKI_HEIGHT
						? b.writes.filter((w) => w.ordinal !== WKIKI_ORDINAL)
						: b.writes,
				),
				{ handlerCode: CLEAN, from: FROM, to: TO },
			);
			expect(r.failures[0]).toMatchObject({
				step: "inputs",
				height: WKIKI_HEIGHT,
			});
			expect(r.failures[0]?.message).toContain(tokenKey("token-wkiki"));
		});

		test("the same definition with Date.now() in the handler breaks the handlers link", async () => {
			const r = await replayBlocks(fixtureDeps(), {
				handlerCode: handlerCode(
					'ctx.upsert("reserves", { token: event.key }, { amount: BigInt(Date.now()) });',
				),
				from: FROM,
				to: TO,
			});
			expect(r.failures[0]).toMatchObject({ step: "handlers" });
			expect(r.failures[0]?.message).toContain("NondeterminismError");
		});
	},
);
