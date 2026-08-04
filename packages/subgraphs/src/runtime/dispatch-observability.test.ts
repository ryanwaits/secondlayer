import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
/**
 * f071 Stage A observability: `resolveRoute` (block-processor.ts) logs once,
 * at the point the route is computed and cached, which handler-execution
 * path a subgraph resolved to. Cached per subgraph, so a second block for
 * the SAME subgraph must NOT log again — this is what stops the hook from
 * turning into a per-block log line.
 *
 * Two cases:
 *   1. capability + rollout both off (the only state committed code
 *      produces) — two blocks, same subgraph, exactly one "in-process" line.
 *   2. both on, test-only fixture flip (mirrors dispatch-dark-wiring.test.ts)
 *      — one block, exactly one "sandbox" line.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Database, Event, Transaction } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import { generateSubgraphSQL } from "../schema/generator.ts";
import type { SubgraphDefinition, SubgraphHandler } from "../types.ts";
import type { PreloadedBlockData } from "./block-processor.ts";
import { invalidateSubgraphRoute, processBlock } from "./block-processor.ts";
import { bundleHandlerCode } from "./sandbox/bundle.ts";
import { shutdownSandboxPool } from "./sandbox/host.ts";

const SKIP = !process.env.DATABASE_URL;
const DISPATCH_LOG_MESSAGE = "subgraph handler dispatch path resolved";

/** Records every console.info call whose message matches
 *  DISPATCH_LOG_MESSAGE while active; restores the original in `finally`
 *  (same scoped-monkey-patch shape dispatch-dark-wiring.test.ts uses for
 *  SubgraphContext.prototype.flush) so no other test file sharing this
 *  process's console can observe the patch. */
async function withDispatchLogCapture<T>(
	fn: () => Promise<T>,
): Promise<{ result: T; lines: Record<string, unknown>[] }> {
	const original = console.info;
	const lines: Record<string, unknown>[] = [];
	console.info = (...args: unknown[]) => {
		const [msg] = args;
		// logger.ts's dev-mode formatMessage emits one string:
		// `[ts] INFO: <message> {"subgraph":...,"path":...}` — the meta object
		// is the JSON suffix starting at the first `{`, not a separate arg.
		if (typeof msg === "string" && msg.includes(DISPATCH_LOG_MESSAGE)) {
			const jsonStart = msg.indexOf("{");
			try {
				lines.push(
					jsonStart === -1 ? { raw: msg } : JSON.parse(msg.slice(jsonStart)),
				);
			} catch {
				lines.push({ raw: msg });
			}
		}
		original(...(args as []));
	};
	try {
		const result = await fn();
		return { result, lines };
	} finally {
		console.info = original;
	}
}

function fixtureBlock(
	height: number,
	sender: string,
	txId: string,
): PreloadedBlockData {
	const tx = {
		tx_id: txId,
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
			hash: `0xdoblock${height}`,
			parent_hash: `0xdoblock${height - 1}`,
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

let db: Kysely<Database>;
const createdSchemas: string[] = [];
const createdSubgraphNames: string[] = [];
const accountId = randomUUID();
const prevGlobalFlag = process.env.SUBGRAPH_SANDBOX_WORKERS;

beforeAll(() => {
	db = getDb();
});

afterEach(() => {
	if (prevGlobalFlag === undefined) delete process.env.SUBGRAPH_SANDBOX_WORKERS;
	else process.env.SUBGRAPH_SANDBOX_WORKERS = prevGlobalFlag;
});

afterAll(async () => {
	shutdownSandboxPool();
	for (const name of createdSubgraphNames) {
		invalidateSubgraphRoute(name);
		await db.deleteFrom("subgraphs").where("name", "=", name).execute();
	}
	for (const s of createdSchemas) {
		await sql.raw(`DROP SCHEMA IF EXISTS "${s}" CASCADE`).execute(db);
	}
	if (prevGlobalFlag === undefined) delete process.env.SUBGRAPH_SANDBOX_WORKERS;
	else process.env.SUBGRAPH_SANDBOX_WORKERS = prevGlobalFlag;
});

describe.skipIf(SKIP)(
	"resolveRoute dispatch-path logging — once per route resolution, not per block",
	() => {
		it("capability + rollout both off: two blocks for the same subgraph produce exactly one in-process line", async () => {
			const suffix = randomUUID().slice(0, 8);
			const name = `dispatch-obs-off-${suffix}`;
			const pgSchema = `sg_do_off_${suffix}`;
			const def: SubgraphDefinition = {
				name,
				startBlock: 1,
				sources: { tick: { type: "contract_call" } },
				schema: {
					hits: {
						columns: { sender: { type: "principal" } },
					},
				} as unknown as SubgraphDefinition["schema"],
				handlers: {
					tick: (async (
						e: unknown,
						ctx: import("./context.ts").SubgraphContext,
					) => {
						const ev = e as { tx: { sender: string } };
						ctx.insert("hits", { sender: ev.tx.sender });
					}) as unknown as SubgraphHandler,
				},
			};

			createdSchemas.push(pgSchema);
			await sql.raw(`CREATE SCHEMA IF NOT EXISTS "${pgSchema}"`).execute(db);
			await sql
				.raw(
					`CREATE TABLE "${pgSchema}"."hits" (
						_id BIGSERIAL PRIMARY KEY,
						sender TEXT NOT NULL,
						_block_height BIGINT NOT NULL,
						_tx_id TEXT NOT NULL,
						_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
					)`,
				)
				.execute(db);

			createdSubgraphNames.push(name);
			await db
				.insertInto("subgraphs")
				.values({
					name,
					status: "active",
					definition: def as unknown as Record<string, unknown>,
					schema_hash: "test",
					handler_path: "test",
					schema_name: pgSchema,
					account_id: accountId,
					last_processed_block: 0,
				})
				.execute();

			delete process.env.SUBGRAPH_SANDBOX_WORKERS;
			const sender = "SP1G48FZ4Y9SMP2C5HPRGQ8X9XQ7Y0Y9F9PMKQZ7H";
			const { lines } = await withDispatchLogCapture(async () => {
				await processBlock(def, name, 100, {
					preloaded: fixtureBlock(100, sender, `0xdo-off-${suffix}-a`),
				});
				await processBlock(def, name, 101, {
					preloaded: fixtureBlock(101, sender, `0xdo-off-${suffix}-b`),
				});
			});

			expect(lines.length).toBe(1);
			expect(lines[0]?.subgraph).toBe(name);
			expect(lines[0]?.path).toBe("in-process");
		});

		it("capability + rollout both on (test-only fixture flip): one block produces exactly one sandbox line", async () => {
			const suffix = randomUUID().slice(0, 8);
			const name = `dispatch-obs-on-${suffix}`;
			const pgSchema = `sg_do_on_${suffix}`;

			const HANDLER_SOURCE = `
import { defineSubgraph } from "@secondlayer/subgraphs";
export default defineSubgraph({
	name: "dispatch-obs-on-fixture",
	sources: { tick: { type: "contract_call" } },
	schema: {
		hits: { columns: { sender: { type: "principal" } } },
	},
	handlers: {
		tick: (event, ctx) => {
			ctx.insert("hits", { sender: event.tx.sender });
		},
	},
});
`;
			const bundled = await bundleHandlerCode(HANDLER_SOURCE);
			const dir = mkdtempSync(join(tmpdir(), "sg-dispatch-obs-"));
			const file = join(dir, "subgraph.mjs");
			writeFileSync(file, bundled);
			const mod = await import(pathToFileURL(file).href);
			const def = (mod.default ?? mod) as SubgraphDefinition;

			createdSchemas.push(pgSchema);
			const { statements } = generateSubgraphSQL(def, pgSchema);
			for (const stmt of statements) await sql.raw(stmt).execute(db);

			createdSubgraphNames.push(name);
			await db
				.insertInto("subgraphs")
				.values({
					name,
					status: "active",
					definition: def as unknown as Record<string, unknown>,
					schema_hash: "test",
					handler_path: "test",
					handler_code: HANDLER_SOURCE,
					schema_name: pgSchema,
					account_id: accountId,
					last_processed_block: 0,
					// TEST-ONLY flip — never set this way in committed code (see
					// flag.ts's docblock; mirrors dispatch-dark-wiring.test.ts).
					sandbox_workers: true,
				})
				.execute();

			process.env.SUBGRAPH_SANDBOX_WORKERS = "1";
			const sender = "SP1G48FZ4Y9SMP2C5HPRGQ8X9XQ7Y0Y9F9PMKQZ7H";
			const { result, lines } = await withDispatchLogCapture(() =>
				processBlock(def, name, 200, {
					preloaded: fixtureBlock(200, sender, `0xdo-on-${suffix}`),
				}),
			);

			expect(result.skipped).toBe(false);
			expect(lines.length).toBe(1);
			expect(lines[0]?.subgraph).toBe(name);
			expect(lines[0]?.path).toBe("sandbox");
		});
	},
);
