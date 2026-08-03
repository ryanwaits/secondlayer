import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
// f071 Stage A — Step 3's fixture verification: flip `subgraphs.sandbox_workers`
// on a FIXTURE row (test-only — never a default, never committed as `true`
// anywhere else) and drive a REAL block through the REAL `processBlock`
// managed-path dispatch (`block-processor.ts`'s `sandboxEnabled(...)` branch
// added by this plan), proving:
//   1. With the flag off (the only state any committed code produces),
//      `processBlock` is byte-identical to before this plan — covered by the
//      untouched pre-existing suite (`live-path-replay-guard.test.ts`,
//      `accumulator-correctness.test.ts`, `increment-check-constraint.test.ts`,
//      the reorg tests) all staying green with zero edits.
//   2. With the flag flipped LOCALLY, in this test only, `processBlock`
//      genuinely reaches `runHandlersSandboxed` (not a lookalike) and
//      produces a byte-equal `FlushManifest` vs the in-process path run on
//      the identical fixture (same handler source, same block/tx input).
//
// `processBlock` doesn't expose its internal `FlushManifest` (it's consumed
// by `emitSubscriptionOutbox` inside the same transaction and never
// returned) — so this test captures it the same way host-parity.test.ts
// captures the sandbox side's, but at one layer up: a scoped, restored-in-
// `finally` spy on `SubgraphContext.prototype.flush`, wrapped tightly around
// a single `processBlock` call so no other test file sharing this process's
// module registry can observe the patched prototype.
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Database, Event, Transaction } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import { generateSubgraphSQL } from "../../schema/generator.ts";
import type { SubgraphDefinition } from "../../types.ts";
import type { PreloadedBlockData } from "../block-processor.ts";
import { processBlock } from "../block-processor.ts";
import { type FlushManifest, SubgraphContext } from "../context.ts";
import { bundleHandlerCode } from "./bundle.ts";

const SKIP = !process.env.DATABASE_URL;

// One handler source, used two ways (host-parity.test.ts's zero-drift
// pattern): bundled+imported once to get the real `SubgraphDefinition`
// object `processBlock` needs for BOTH runs, and stored verbatim as the
// sandboxed row's `handler_code` so the sandbox subprocess bundles the
// IDENTICAL source independently. Any divergence would be a bundling bug,
// not a fixture-construction artifact.
const HANDLER_SOURCE = `
import { defineSubgraph } from "@secondlayer/subgraphs";
export default defineSubgraph({
	name: "dark-wiring-fixture",
	sources: { tick: { type: "contract_call" } },
	schema: {
		hits: {
			columns: {
				sender: { type: "principal" },
				note: { type: "text", nullable: true },
			},
		},
	},
	handlers: {
		tick: (event, ctx) => {
			ctx.insert("hits", { sender: event.tx.sender, note: "seen" });
		},
	},
});
`;

async function loadDef(): Promise<SubgraphDefinition> {
	const bundled = await bundleHandlerCode(HANDLER_SOURCE);
	const dir = mkdtempSync(join(tmpdir(), "sg-dark-wiring-"));
	const file = join(dir, "subgraph.mjs");
	writeFileSync(file, bundled);
	const mod = await import(pathToFileURL(file).href);
	return (mod.default ?? mod) as SubgraphDefinition;
}

function fixtureBlock(height: number, sender: string): PreloadedBlockData {
	const tx = {
		tx_id: `0xdarkwiring${height}`,
		block_height: height,
		tx_index: 0,
		type: "contract_call",
		sender,
		status: "success",
		contract_id: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.t",
		function_name: "tick",
		function_args: null,
		raw_result: null,
		raw_tx: "0x00",
		created_at: new Date(0),
	} as Transaction;
	return {
		block: {
			height,
			hash: `0xdwblock${height}`,
			parent_hash: `0xdwblock${height - 1}`,
			burn_block_height: height,
			burn_block_hash: null,
			index_block_hash: null,
			timestamp: 1_700_000_000 + height,
			canonical: true,
			created_at: new Date(0),
		},
		txs: [tx],
		events: [] as Event[],
	};
}

/** Run ONE processBlock call with a scoped spy on SubgraphContext.prototype.flush
 *  capturing the manifest it returns — patched immediately before the call
 *  and restored in `finally`, so the window where the shared prototype is
 *  mutated never outlives this single (synchronous-until-its-awaits) call,
 *  and never leaks across `bun test`'s shared module registry into another
 *  test file. */
async function processBlockCapturingManifest(
	...args: Parameters<typeof processBlock>
): Promise<{
	result: Awaited<ReturnType<typeof processBlock>>;
	manifest: FlushManifest | null;
}> {
	const original = SubgraphContext.prototype.flush;
	let manifest: FlushManifest | null = null;
	SubgraphContext.prototype.flush = async function (
		this: SubgraphContext,
	): Promise<FlushManifest> {
		const m = await original.call(this);
		manifest = m;
		return m;
	};
	try {
		const result = await processBlock(...args);
		return { result, manifest };
	} finally {
		SubgraphContext.prototype.flush = original;
	}
}

let db: Kysely<Database>;
const createdSchemas: string[] = [];
const createdSubgraphNames: string[] = [];
const accountId = randomUUID();
const prevGlobalFlag = process.env.SUBGRAPH_SANDBOX_WORKERS;

async function createHitsTable(
	pgSchema: string,
	def: SubgraphDefinition,
): Promise<void> {
	createdSchemas.push(pgSchema);
	const { statements } = generateSubgraphSQL(def, pgSchema);
	for (const stmt of statements) await sql.raw(stmt).execute(db);
}

async function registerSubgraph(
	def: SubgraphDefinition,
	name: string,
	pgSchema: string,
	handlerCode: string | null,
	sandboxWorkers: boolean,
): Promise<void> {
	createdSubgraphNames.push(name);
	await db
		.insertInto("subgraphs")
		.values({
			name,
			status: "active",
			definition: def as unknown as Record<string, unknown>,
			schema_hash: "test",
			handler_path: "test",
			handler_code: handlerCode,
			schema_name: pgSchema,
			account_id: accountId,
			last_processed_block: 0,
			sandbox_workers: sandboxWorkers,
		})
		.execute();
}

async function readHits(pgSchema: string): Promise<Record<string, unknown>[]> {
	const { rows } = await sql
		.raw(`SELECT * FROM "${pgSchema}"."hits" ORDER BY sender`)
		.execute(db);
	return (rows as Record<string, unknown>[]).map((r) => {
		const { _id, _created_at, ...rest } = r;
		return rest;
	});
}

beforeAll(() => {
	db = getDb();
});

afterEach(() => {
	// Belt-and-braces: no committed code ever reads this true across a whole
	// suite run, but restore between tests in this file regardless, since
	// this file is the only one that ever sets it.
	if (prevGlobalFlag === undefined) delete process.env.SUBGRAPH_SANDBOX_WORKERS;
	else process.env.SUBGRAPH_SANDBOX_WORKERS = prevGlobalFlag;
});

afterAll(async () => {
	for (const name of createdSubgraphNames) {
		await db.deleteFrom("subgraphs").where("name", "=", name).execute();
	}
	for (const s of createdSchemas) {
		await sql.raw(`DROP SCHEMA IF EXISTS "${s}" CASCADE`).execute(db);
	}
	if (prevGlobalFlag === undefined) delete process.env.SUBGRAPH_SANDBOX_WORKERS;
	else process.env.SUBGRAPH_SANDBOX_WORKERS = prevGlobalFlag;
});

describe.skipIf(SKIP)(
	"f071 Stage A dark wiring — flipping subgraphs.sandbox_workers on a fixture row routes processBlock through the real subprocess path",
	() => {
		it("in-process (flag off, the only state committed code produces) and sandboxed (flag flipped, test-only) runs of the identical fixture produce byte-equal FlushManifests and identical rows", async () => {
			const def = await loadDef();
			const suffix = randomUUID().slice(0, 8);

			const offName = `dark-wiring-off-${suffix}`;
			const offSchema = `sg_dark_off_${suffix}`;
			await createHitsTable(offSchema, def);
			// sandbox_workers = false (default posture) — no handler_code needed,
			// mirrors every real row today.
			await registerSubgraph(def, offName, offSchema, null, false);

			const onName = `dark-wiring-on-${suffix}`;
			const onSchema = `sg_dark_on_${suffix}`;
			await createHitsTable(onSchema, def);
			// sandbox_workers = true — TEST-ONLY flip. Never set this way (or any
			// way) in committed code; see flag.ts's docblock.
			await registerSubgraph(def, onName, onSchema, HANDLER_SOURCE, true);

			const sender = "SP1G48FZ4Y9SMP2C5HPRGQ8X9XQ7Y0Y9F9PMKQZ7H";

			// Flag off (default): must dispatch in-process regardless of the
			// global env gate's state, because this subgraph's own column is
			// false — AND semantics (flag.ts).
			delete process.env.SUBGRAPH_SANDBOX_WORKERS;
			const offRun = await processBlockCapturingManifest(def, offName, 500, {
				preloaded: fixtureBlock(500, sender),
			});
			expect(offRun.result.skipped).toBe(false);
			expect(offRun.result.errors).toBe(0);
			expect(offRun.manifest).not.toBeNull();

			// Flag on: BOTH the global gate AND this row's column must be true for
			// sandboxEnabled() to route here — this is the actual production
			// dispatch predicate in block-processor.ts, not a bypass of it.
			process.env.SUBGRAPH_SANDBOX_WORKERS = "1";
			const onRun = await processBlockCapturingManifest(def, onName, 500, {
				preloaded: fixtureBlock(500, sender),
			});
			expect(onRun.result.skipped).toBe(false);
			expect(onRun.result.errors).toBe(0);
			expect(onRun.manifest).not.toBeNull();

			// Same processed/errors shape.
			expect(onRun.result.processed).toBe(offRun.result.processed);
			expect(onRun.result.errors).toBe(offRun.result.errors);

			// The load-bearing assertion: byte-equal FlushManifest between the
			// dark (in-process) and flipped (subprocess) dispatch, end-to-end
			// through the real block-processor.ts branch — not a lookalike, and
			// not the runHandlersSandboxed-level check host-parity.test.ts
			// already does one layer down.
			expect(onRun.manifest).toEqual(offRun.manifest);

			// Row-level parity, independent confirmation of the same thing.
			const offRows = await readHits(offSchema);
			const onRows = await readHits(onSchema);
			expect(onRows).toEqual(offRows);
			expect(offRows).toEqual([
				{
					sender,
					note: "seen",
					_block_height: "500",
					_tx_id: "0xdarkwiring500",
				},
			]);
		});
	},
);
