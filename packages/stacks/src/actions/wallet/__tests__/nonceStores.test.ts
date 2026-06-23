import { describe, expect, it } from "bun:test";
import { type NonceStore, createNonceManager } from "../nonceManager.ts";
import {
	type RedisLike,
	type SqlLike,
	postgresStore,
	redisStore,
} from "../nonceStores.ts";

/**
 * In-memory Redis good enough for `GET`/`SET`/`INCR`/`DEL` and the two `EVAL`
 * scripts the store uses. Command bodies are synchronous (no `await` mid-body),
 * so — like a real single-threaded Redis — concurrent reservers serialize and
 * the atomic-reserve guarantee holds for real against this fake.
 */
function createFakeRedis(backing = new Map<string, string>()): {
	redis: RedisLike;
	backing: Map<string, string>;
} {
	const redis: RedisLike = {
		async send(command, args) {
			switch (command) {
				case "DEL":
					backing.delete(args[0]);
					return 1;
				case "EVAL": {
					const [script, , key, arg] = args;
					let v = backing.get(key);
					if (v === undefined) {
						// SEED_OR_TAKE seeds from ARGV[1]; TAKE_IF_PRESENT bails.
						if (!script.includes("SET")) return null;
						v = arg;
						backing.set(key, v);
					}
					backing.set(key, String(BigInt(v) + 1n));
					return v;
				}
				default:
					throw new Error(`fake redis: unhandled ${command}`);
			}
		},
	};
	return { redis, backing };
}

/**
 * In-memory Postgres for the exact query shapes `postgresStore` issues. Bodies
 * are synchronous up to the mutation, modelling the atomicity of an upsert /
 * `UPDATE ... RETURNING` under a row lock.
 */
function createFakeSql(backing = new Map<string, bigint>()): {
	sql: SqlLike;
	backing: Map<string, bigint>;
} {
	const sql: SqlLike = async (strings, ...values) => {
		const q = strings.join("?");
		if (q.includes("CREATE TABLE")) return [];
		if (q.includes("UPDATE stacks_nonce_state")) {
			const key = values[0] as string;
			const cur = backing.get(key);
			if (cur === undefined) return [];
			backing.set(key, cur + 1n);
			return [{ nonce: cur.toString() }];
		}
		if (q.includes("INSERT INTO stacks_nonce_state")) {
			const key = values[0] as string;
			const seed = BigInt(values[1] as string);
			const cur = backing.get(key);
			if (cur === undefined) {
				backing.set(key, seed);
				return [{ nonce: (seed - 1n).toString() }];
			}
			backing.set(key, cur + 1n);
			return [{ nonce: cur.toString() }];
		}
		if (q.includes("DELETE FROM stacks_nonce_state")) {
			backing.delete(values[0] as string);
			return [];
		}
		throw new Error(`fake sql: unhandled ${q}`);
	};
	return { sql, backing };
}

const KEY = "1:SPSENDER";

/**
 * Behavioural contract every persisted store must satisfy. `makeStore` builds a
 * store; `makeStoreSharing` builds a *fresh* store over the *same* backing (the
 * restart / second-worker case).
 */
function runStoreContract(
	name: string,
	makeStore: () => { store: NonceStore; sharing: () => NonceStore },
) {
	describe(name, () => {
		const floor = () => Promise.resolve(5n);

		it("seeds from the floor then increments", async () => {
			const { store } = makeStore();
			const out: bigint[] = [];
			for (let i = 0; i < 4; i++) out.push(await store.reserve(KEY, floor));
			expect(out).toEqual([5n, 6n, 7n, 8n]);
		});

		it("reserves are unique and strictly increasing under concurrency", async () => {
			const { store } = makeStore();
			const results = await Promise.all(
				Array.from({ length: 25 }, () => store.reserve(KEY, floor)),
			);
			expect(new Set(results).size).toBe(25);
			const sorted = [...results].sort((a, b) => Number(a - b));
			expect(sorted[0]).toBe(5n);
			expect(sorted[24]).toBe(29n);
		});

		it("a second worker over the same backing continues without collision (restart / multi-process)", async () => {
			const { store, sharing } = makeStore();
			const a = await store.reserve(KEY, floor); // 5
			const b = await store.reserve(KEY, floor); // 6

			const worker2 = sharing();
			const c = await worker2.reserve(KEY, floor); // 7 — NOT 5
			const d = await store.reserve(KEY, floor); // 8

			expect([a, b, c, d]).toEqual([5n, 6n, 7n, 8n]);
		});

		it("two cold workers racing on a fresh key never collide", async () => {
			const { store, sharing } = makeStore();
			const worker2 = sharing();
			const [a, b] = await Promise.all([
				store.reserve(KEY, floor),
				worker2.reserve(KEY, floor),
			]);
			expect(new Set([a, b]).size).toBe(2);
			expect([a, b].sort((x, y) => Number(x - y))).toEqual([5n, 6n]);
		});

		it("reset re-syncs to the confirmed floor (dropped-tx / reorg recovery)", async () => {
			const { store } = makeStore();
			expect(await store.reserve(KEY, floor)).toBe(5n);
			expect(await store.reserve(KEY, floor)).toBe(6n);

			// A reserved tx was dropped from the mempool and GC'd; the counter
			// overshot. reset() forgets it so the next reserve re-reads the floor.
			await store.reset(KEY);
			expect(await store.reserve(KEY, () => Promise.resolve(6n))).toBe(6n);
		});
	});
}

runStoreContract("redisStore (fake)", () => {
	const { backing } = createFakeRedis();
	const shared = backing;
	return {
		store: redisStore({ redis: createFakeRedis(shared).redis }),
		sharing: () => redisStore({ redis: createFakeRedis(shared).redis }),
	};
});

runStoreContract("postgresStore (fake)", () => {
	const shared = new Map<string, bigint>();
	return {
		store: postgresStore({ sql: createFakeSql(shared).sql }),
		sharing: () => postgresStore({ sql: createFakeSql(shared).sql }),
	};
});

describe("createNonceManager with a persisted store", () => {
	it("threads the store through consume and reset", async () => {
		const { redis } = createFakeRedis();
		const manager = createNonceManager({
			source: { get: async () => 100n },
			store: redisStore({ redis }),
		});
		const client = { chain: { id: 1 } } as never;

		expect(await manager.consume({ client, address: "SP1" })).toBe(100n);
		expect(await manager.consume({ client, address: "SP1" })).toBe(101n);

		await manager.reset({ client, address: "SP1" });
		expect(await manager.consume({ client, address: "SP1" })).toBe(100n);
	});
});

// Live integration — runs only when real infra is configured.
// REDIS_URL=redis://localhost:6379 / DATABASE_URL=postgres://... bun test
const hasRedis = !!process.env.REDIS_URL;
const hasPg = !!process.env.DATABASE_URL;

describe("live persisted stores", () => {
	it.skipIf(!hasRedis)("redisStore against real Redis", async () => {
		const { RedisClient } = await import("bun");
		// biome-ignore lint/style/noNonNullAssertion: guarded by skipIf(!hasRedis)
		const redis = new RedisClient(process.env.REDIS_URL!);
		const store = redisStore({ redis, prefix: `test:${Date.now()}:` });
		const key = "live";
		await store.reset(key);
		const results = await Promise.all(
			Array.from({ length: 20 }, () =>
				store.reserve(key, () => Promise.resolve(0n)),
			),
		);
		expect(new Set(results).size).toBe(20);
		await store.reset(key);
		redis.close();
	});

	it.skipIf(!hasPg)("postgresStore against real Postgres", async () => {
		const { SQL } = await import("bun");
		// biome-ignore lint/style/noNonNullAssertion: guarded by skipIf(!hasPg)
		const sql = new SQL(process.env.DATABASE_URL!);
		const store = postgresStore({ sql: sql as unknown as SqlLike });
		const key = `live:${Date.now()}`;
		const results = await Promise.all(
			Array.from({ length: 20 }, () =>
				store.reserve(key, () => Promise.resolve(0n)),
			),
		);
		expect(new Set(results).size).toBe(20);
		await store.reset(key);
		await sql.end();
	});
});
