import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import { SubgraphContext } from "./context.ts";

/**
 * The increment flush is UPDATE-first, then a guarded INSERT for the missing
 * row (see the `NOT insert-on-conflict` rationale in context.ts). Under READ
 * COMMITTED that leaves a lost-update window when the row does NOT yet exist
 * and two block transactions for the same subgraph flush the same key:
 *
 *   T1 UPDATE -> 0 rows      T2 UPDATE -> 0 rows
 *   T1 INSERT -> 1 row, COMMIT
 *                            T2 INSERT ... WHERE NOT EXISTS -> sees T1's
 *                            committed row -> inserts NOTHING, no error.
 *                            T2's delta is silently discarded.
 *
 * Concurrent same-subgraph block transactions are reachable: `processBlockRange`
 * (reindex.ts) never takes the per-subgraph block lock that `catchUpSubgraph`
 * uses, and a backfill op runs at status 'active' — the exact status the live
 * catch-up walk selects on.
 */

const SKIP = !process.env.DATABASE_URL;
const SCHEMA = `sg_inc_race_${randomUUID().slice(0, 8)}`;

const SUBGRAPH_SCHEMA = {
	holdings: {
		columns: {
			address: { type: "principal" },
			balance: { type: "int" },
		},
		uniqueKeys: [["address"]],
	},
	// biome-ignore lint/suspicious/noExplicitAny: minimal schema for the harness
} as any;

type StatementHook = (
	sqlText: string,
	phase: "before" | "after",
) => Promise<void> | void;

/**
 * Wrap a Kysely transaction so every statement the real flush issues passes
 * through `hook` — the only way to pause a flush *between* its UPDATE and its
 * INSERT and make the race deterministic. Everything else (SQL generation,
 * statement order, Postgres) is the production path.
 */
// biome-ignore lint/suspicious/noExplicitAny: proxying an opaque Kysely handle
function gated(tx: any, hook: StatementHook): any {
	const realExecutor = tx.getExecutor();
	const executor = new Proxy(realExecutor, {
		get(target, prop) {
			if (prop === "executeQuery") {
				// biome-ignore lint/suspicious/noExplicitAny: compiled query passthrough
				return async (compiled: any) => {
					await hook(compiled.sql, "before");
					const result = await realExecutor.executeQuery(compiled);
					await hook(compiled.sql, "after");
					return result;
				};
			}
			const value = Reflect.get(target, prop);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return new Proxy(tx, {
		get(target, prop) {
			if (prop === "getExecutor") return () => executor;
			const value = Reflect.get(target, prop);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

const isUpdate = (s: string) => /^\s*UPDATE/i.test(s);
const isInsert = (s: string) => /^\s*INSERT/i.test(s);

// biome-ignore lint/suspicious/noExplicitAny: proxied transaction handle
function ctxOn(db: any, height: number) {
	return new SubgraphContext(
		db,
		SCHEMA,
		SUBGRAPH_SCHEMA,
		{ height, hash: "0x0", timestamp: 0, burnBlockHeight: 0 },
		// biome-ignore lint/suspicious/noExplicitAny: minimal tx meta
		{ tx_id: `0xrace${height}` } as any,
		false,
		false,
	);
}

async function balanceOf(address: string): Promise<string | undefined> {
	const rows = await sql
		.raw(
			`SELECT balance::text AS b FROM "${SCHEMA}"."holdings" WHERE address = '${address}'`,
		)
		.execute(getDb());
	// biome-ignore lint/suspicious/noExplicitAny: raw row
	return (rows.rows[0] as any)?.b;
}

describe.skipIf(SKIP)("increment flush under concurrent row creation", () => {
	afterAll(async () => {
		await sql`DROP SCHEMA IF EXISTS ${sql.raw(`"${SCHEMA}"`)} CASCADE`.execute(
			getDb(),
		);
	});

	test("creates the harness schema", async () => {
		const db = getDb();
		await sql.raw(`CREATE SCHEMA "${SCHEMA}"`).execute(db);
		await sql
			.raw(
				`CREATE TABLE "${SCHEMA}"."holdings" (
					_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					_block_height bigint, _tx_id text, _created_at timestamptz,
					address text, balance numeric NOT NULL DEFAULT 0,
					CONSTRAINT uq_inc_race_address UNIQUE (address)
				)`,
			)
			.execute(db);
		expect(await balanceOf("SP_NONE")).toBeUndefined();
	});

	test("both deltas land when the loser's INSERT is beaten by a committed row", async () => {
		const db = getDb();
		const key = "SP_LOST_UPDATE";

		const t1UpdateDone = deferred();
		const t1MayInsert = deferred();
		const t2UpdateDone = deferred();
		const t1Committed = deferred();

		// biome-ignore lint/suspicious/noExplicitAny: proxied transaction handle
		const t1 = db.transaction().execute(async (tx: any) => {
			const ctx = ctxOn(
				gated(tx, async (text, phase) => {
					if (phase === "after" && isUpdate(text)) t1UpdateDone.resolve();
					if (phase === "before" && isInsert(text)) await t1MayInsert.promise;
				}),
				100,
			);
			ctx.increment("holdings", { address: key }, { balance: 100n });
			await ctx.flush();
		});

		// biome-ignore lint/suspicious/noExplicitAny: proxied transaction handle
		const t2 = db.transaction().execute(async (tx: any) => {
			const ctx = ctxOn(
				gated(tx, async (text, phase) => {
					// First UPDATE only after T1's, so both see an absent row.
					if (phase === "before" && isUpdate(text)) await t1UpdateDone.promise;
					if (phase === "after" && isUpdate(text)) t2UpdateDone.resolve();
					// The window: T1's row is committed before T2's INSERT runs.
					if (phase === "before" && isInsert(text)) await t1Committed.promise;
				}),
				101,
			);
			ctx.increment("holdings", { address: key }, { balance: 5n });
			await ctx.flush();
		});

		await t2UpdateDone.promise;
		t1MayInsert.resolve();
		await t1;
		t1Committed.resolve();
		await t2;

		expect(await balanceOf(key)).toBe("105");
	});

	test("the delta is applied exactly once when this flush wins the INSERT", async () => {
		const db = getDb();
		const key = "SP_INSERT_WINNER";

		const t1UpdateDone = deferred();
		const t2UpdateDone = deferred();
		const t2InsertAttempted = deferred();

		// T1 creates the row, then ROLLS BACK — T2's INSERT blocks on the unique
		// index, then succeeds. A retry that ran after a successful INSERT would
		// double-apply T2's delta here.
		const t1 = db
			.transaction()
			// biome-ignore lint/suspicious/noExplicitAny: proxied transaction handle
			.execute(async (tx: any) => {
				const ctx = ctxOn(
					gated(tx, async (text, phase) => {
						if (phase === "after" && isUpdate(text)) t1UpdateDone.resolve();
						if (phase === "before" && isInsert(text))
							await t2UpdateDone.promise;
					}),
					200,
				);
				ctx.increment("holdings", { address: key }, { balance: 70n });
				await ctx.flush();
				// Wait until T2 is blocked on the unique index, then abort.
				await t2InsertAttempted.promise;
				throw new Error("rollback-on-purpose");
			})
			.catch((err: unknown) => {
				if (!(err instanceof Error) || err.message !== "rollback-on-purpose") {
					throw err;
				}
			});

		// biome-ignore lint/suspicious/noExplicitAny: proxied transaction handle
		const t2 = db.transaction().execute(async (tx: any) => {
			const ctx = ctxOn(
				gated(tx, async (text, phase) => {
					if (phase === "before" && isUpdate(text)) await t1UpdateDone.promise;
					if (phase === "after" && isUpdate(text)) t2UpdateDone.resolve();
					if (phase === "before" && isInsert(text)) {
						// Give T1's uncommitted insert time to land so T2 blocks on it.
						await new Promise((r) => setTimeout(r, 50));
						t2InsertAttempted.resolve();
					}
				}),
				201,
			);
			ctx.increment("holdings", { address: key }, { balance: 9n });
			await ctx.flush();
		});

		await Promise.all([t1, t2]);

		expect(await balanceOf(key)).toBe("9");
	});

	test("sequential increments still apply exactly once each", async () => {
		const key = "SP_SEQUENTIAL";
		const db = getDb();

		const a = ctxOn(db, 300);
		a.increment("holdings", { address: key }, { balance: 7n });
		await a.flush();
		expect(await balanceOf(key)).toBe("7");

		const b = ctxOn(db, 301);
		b.increment("holdings", { address: key }, { balance: 3n });
		await b.flush();
		expect(await balanceOf(key)).toBe("10");

		const c = ctxOn(db, 302);
		c.increment("holdings", { address: key }, { balance: -10n });
		await c.flush();
		expect(await balanceOf(key)).toBe("0");
	});
});
