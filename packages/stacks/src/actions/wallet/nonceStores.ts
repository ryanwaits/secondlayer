import type { NonceStore } from "./nonceManager.ts";

/**
 * Persisted {@link NonceStore} adapters for multi-process / multi-builder
 * deployments (the smart-wallet-as-a-service case).
 *
 * The in-memory {@link memoryStore} is correct only within one process: two
 * workers sharing a signing key both read the same confirmed floor and collide.
 * These adapters move the atomic reserve into a shared datastore — Redis `INCR`
 * inside an `EVAL`, or a single Postgres upsert under a row lock — so the store
 * itself becomes the cross-process lock and the durable source of truth.
 *
 * Both are dependency-injected: pass your own `Bun.redis` / `Bun.sql` client.
 * No global `Bun` reference, so importing this module is runtime-agnostic.
 */

/** Minimal structural shape of a `Bun.redis` client (the `send` escape hatch). */
export type RedisLike = {
	send(command: string, args: string[]): Promise<unknown>;
};

export type RedisStoreParams = {
	redis: RedisLike;
	/** Key prefix for stored nonce counters. Default `"stacks:nonce:"`. */
	prefix?: string;
};

// Warm path: counter exists → atomically hand out the current value and bump.
// Returns the nonce (bulk string) or `false` (RESP nil) when the key is unset.
const TAKE_IF_PRESENT = `local v = redis.call('GET', KEYS[1])
if v == false then return false end
redis.call('INCR', KEYS[1])
return v`;

// Cold path: seed from the confirmed floor if still unset, then hand out and
// bump. Atomic, so two racing cold reservers can never return the same nonce.
const SEED_OR_TAKE = `local v = redis.call('GET', KEYS[1])
if v == false then redis.call('SET', KEYS[1], ARGV[1]); v = ARGV[1] end
redis.call('INCR', KEYS[1])
return v`;

/**
 * Redis-backed nonce store. The atomic reserve lives in a Lua `EVAL`, so it is
 * safe across processes sharing one Redis. The confirmed floor (`getFloor`) is
 * read only once per key, on cold start.
 */
export function redisStore(params: RedisStoreParams): NonceStore {
	const { redis } = params;
	const prefix = params.prefix ?? "stacks:nonce:";

	return {
		async reserve(key, getFloor) {
			const k = prefix + key;
			const present = await redis.send("EVAL", [TAKE_IF_PRESENT, "1", k]);
			if (present != null) return BigInt(present as string | number);

			const floor = await getFloor();
			const seeded = await redis.send("EVAL", [
				SEED_OR_TAKE,
				"1",
				k,
				floor.toString(),
			]);
			return BigInt(seeded as string | number);
		},
		async reset(key) {
			await redis.send("DEL", [prefix + key]);
		},
	};
}

/** Minimal structural shape of a `Bun.sql` tagged-template client. */
export type SqlLike = (
	strings: TemplateStringsArray,
	...values: unknown[]
) => Promise<Array<Record<string, unknown>>>;

export type PostgresStoreParams = {
	sql: SqlLike;
	/**
	 * Run `CREATE TABLE IF NOT EXISTS stacks_nonce_state` lazily on first use.
	 * Default `true`. Set `false` if you manage the schema via migrations.
	 */
	ensureTable?: boolean;
};

/**
 * Postgres-backed nonce store. Each reserve is a single atomic statement under
 * a row lock, so concurrent reservers on the same key serialize and never
 * collide across processes. State is durable — survives restarts.
 *
 * Uses a fixed table `stacks_nonce_state (key text primary key, next numeric)`.
 */
export function postgresStore(params: PostgresStoreParams): NonceStore {
	const { sql } = params;
	const shouldEnsure = params.ensureTable ?? true;
	let ensured = false;

	async function ensureTable() {
		if (!shouldEnsure || ensured) return;
		await sql`CREATE TABLE IF NOT EXISTS stacks_nonce_state (key text PRIMARY KEY, next numeric NOT NULL)`;
		ensured = true;
	}

	return {
		async reserve(key, getFloor) {
			await ensureTable();

			// Warm path: bump and return the pre-increment value atomically.
			const updated =
				await sql`UPDATE stacks_nonce_state SET next = next + 1 WHERE key = ${key} RETURNING next - 1 AS nonce`;
			const warm = updated[0];
			if (warm) return BigInt(String(warm.nonce));

			// Cold path: seed from the confirmed floor. ON CONFLICT keeps the seed
			// atomic against a racing reserver.
			const floor = await getFloor();
			const seeded =
				await sql`INSERT INTO stacks_nonce_state (key, next) VALUES (${key}, ${(floor + 1n).toString()}) ON CONFLICT (key) DO UPDATE SET next = stacks_nonce_state.next + 1 RETURNING next - 1 AS nonce`;
			const cold = seeded[0];
			if (!cold) throw new Error("postgresStore: insert returned no row");
			return BigInt(String(cold.nonce));
		},
		async reset(key) {
			await ensureTable();
			await sql`DELETE FROM stacks_nonce_state WHERE key = ${key}`;
		},
	};
}
