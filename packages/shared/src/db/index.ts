import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { logger } from "../logger.ts";
import type { Database } from "./types.ts";

export type { Database } from "./types.ts";

const DEFAULT_URL =
	"postgres://postgres:postgres@localhost:5432/secondlayer_dev";

interface PoolEntry {
	db: Kysely<Database>;
	rawClient: ReturnType<typeof postgres>;
	/** Last access (ms) — drives LRU eviction of BYO pools. */
	lastUsed: number;
	/** Monotonic counter as a tiebreaker; Date.now() can repeat under load. */
	seq: number;
}

/**
 * Cache of Kysely + raw postgres.js pools keyed by resolved URL.
 * Two getters resolving to the same URL share one entry (single pool) —
 * this is the single-DB backward-compat contract: when only `DATABASE_URL`
 * is set, `getSourceDb() === getTargetDb()` (zero regression vs. pre-dual-DB).
 *
 * The BYO data plane adds one pool per user-owned DB. To stop N user DBs from
 * exhausting connections/FDs, the map is bounded (`DATABASE_MAX_POOLS`, default
 * 25) with LRU eviction — the hot source/target pools are never evicted.
 */
const pools = new Map<string, PoolEntry>();
let poolSeq = 0;

function maxPools(): number {
	return Number.parseInt(process.env.DATABASE_MAX_POOLS ?? "25", 10);
}

/** Close the least-recently-used non-(source/target) pool when over the cap. */
function evictIfNeeded(): void {
	if (pools.size <= maxPools()) return;
	const protectedUrls = new Set([resolveSourceUrl(), resolveTargetUrl()]);
	let lruUrl: string | undefined;
	let lruEntry: PoolEntry | undefined;
	for (const [url, entry] of pools) {
		if (protectedUrls.has(url)) continue;
		if (
			!lruEntry ||
			entry.lastUsed < lruEntry.lastUsed ||
			(entry.lastUsed === lruEntry.lastUsed && entry.seq < lruEntry.seq)
		) {
			lruUrl = url;
			lruEntry = entry;
		}
	}
	if (!lruUrl || !lruEntry) return;
	pools.delete(lruUrl);
	const evicted = lruEntry;
	// Close in the background — never block pool creation on teardown.
	void evicted.db
		.destroy()
		.catch(() => {})
		.then(() => evicted.rawClient.end({ timeout: 5 }))
		.catch(() => {});
}

function resolveSourceUrl(): string {
	return (
		process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL || DEFAULT_URL
	);
}

function resolveTargetUrl(): string {
	return (
		process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL || DEFAULT_URL
	);
}

/** Host[:port]/dbname for a connection URL — credentials stripped. */
function describeDbUrl(url: string): string {
	try {
		const u = new URL(url);
		return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
	} catch {
		return "invalid-url";
	}
}

export interface DbSplitStatus {
	/** "split" when source/target resolve to different DBs, else "single". */
	mode: "split" | "single";
	/** True when the chain/control split is live (distinct DBs). */
	active: boolean;
	/** SOURCE host[:port]/dbname (no credentials). */
	sourceDb: string;
	/** TARGET host[:port]/dbname (no credentials). */
	targetDb: string;
}

/**
 * Resolved source/target DB identity for status/health surfaces. Lets operators
 * see whether the chain/control split is live or dormant (collapsed to one DB)
 * without shelling in. Credentials are never exposed — host/db only.
 *
 * `active` is a STRING-IDENTITY check on the two URLs: it can't catch two
 * distinct URLs that alias the same physical instance (e.g. `postgres` vs
 * `127.0.0.1`, or a swapped/wrong host). Treat `active: true` as "configured
 * for split", not a proof of physical isolation.
 */
export function getDbSplitStatus(): DbSplitStatus {
	const source = resolveSourceUrl();
	const target = resolveTargetUrl();
	const active = source !== target;
	return {
		mode: active ? "split" : "single",
		active,
		sourceDb: describeDbUrl(source),
		targetDb: describeDbUrl(target),
	};
}

/**
 * Boot guard for the chain/control DB split. Surfaces three misconfigurations
 * loudly (fail-soft — logs, never throws, so a misconfig can't brick startup):
 *
 *  1. Silent wrong-DB: a split is requested (one of SOURCE_/TARGET_ set) but
 *     `DATABASE_URL` is absent (the split-prod default) and the OTHER var is
 *     unset, so it falls through to the built-in dev `DEFAULT_URL` — about to
 *     read/write a real-but-wrong database. This is the failure mode the
 *     remove-DATABASE_URL decision creates; catch it.
 *  2. Collapsed split: both vars set but resolve to the same DB (typo, or a
 *     stray `DATABASE_URL` masking the intent).
 *  3. Dormant split (prod only): neither var set, so all services share one
 *     Postgres failure domain. Not an error, but no longer silent.
 */
export function assertDbSplit(): void {
	const isProd = process.env.NODE_ENV === "production";
	const wantsSplit = !!(
		process.env.SOURCE_DATABASE_URL || process.env.TARGET_DATABASE_URL
	);
	const databaseUrlSet = !!process.env.DATABASE_URL;
	const source = resolveSourceUrl();
	const target = resolveTargetUrl();

	if (
		wantsSplit &&
		!databaseUrlSet &&
		(source === DEFAULT_URL || target === DEFAULT_URL)
	) {
		const which =
			source === DEFAULT_URL ? "SOURCE_DATABASE_URL" : "TARGET_DATABASE_URL";
		const msg = `${which} unset and DATABASE_URL absent — resolving to built-in DEFAULT_URL; refusing to silently use the wrong database`;
		if (isProd) console.error(`❌ ${msg}`);
		else console.warn(`⚠️  ${msg}`);
		return;
	}

	if (!wantsSplit) {
		if (isProd) {
			console.warn(
				"⚠️  DB split dormant — all services share one Postgres failure domain (SOURCE_/TARGET_DATABASE_URL unset)",
			);
		}
		return;
	}

	if (source === target) {
		const msg =
			"DB split requested but SOURCE_DATABASE_URL === TARGET_DATABASE_URL (check for a typo or a stray DATABASE_URL fallback)";
		if (isProd) console.error(`❌ ${msg}`);
		else console.warn(`⚠️  ${msg}`);
	}
}

function getOrCreatePool(url: string): PoolEntry {
	const existing = pools.get(url);
	if (existing) {
		existing.lastUsed = Date.now();
		existing.seq = poolSeq++;
		return existing;
	}

	// "Local" = we skip TLS. Any Docker service alias (single-label hostname
	// with no dots) is on an internal network and won't serve TLS.
	const host = (() => {
		try {
			return new URL(url).hostname;
		} catch {
			return "";
		}
	})();
	const isLocal =
		host === "localhost" || host === "127.0.0.1" || !host.includes(".");
	const poolMax = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "20", 10);
	// Close idle connections so a fleet of BYO pools doesn't pin connections it
	// no longer needs (0 = never; postgres.js default).
	const idleTimeout = Number.parseInt(
		process.env.DATABASE_IDLE_TIMEOUT ?? "300",
		10,
	);
	const rawClient = postgres(url, {
		max: poolMax,
		idle_timeout: idleTimeout,
		ssl: isLocal
			? undefined
			: {
					rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
				},
	});
	const db = new Kysely<Database>({
		dialect: new PostgresJSDialect({ postgres: rawClient }),
		// Diagnostic hook: surface the failing SQL whenever postgres rejects
		// with code 42P10 (ON CONFLICT target doesn't match any unique
		// constraint). Temporary — remove once we've caught the culprit
		// query in prod logs and fixed the schema drift.
		log: (event) => {
			if (event.level !== "error") return;
			const err = event.error as {
				code?: string;
				message?: string;
			} | null;
			if (err?.code !== "42P10") return;
			logger.warn("db.on_conflict_constraint_missing", {
				code: err.code,
				message: err.message,
				sql: event.query.sql,
				params: event.query.parameters,
			});
		},
	});
	const entry: PoolEntry = {
		db,
		rawClient,
		lastUsed: Date.now(),
		seq: poolSeq++,
	};
	pools.set(url, entry);
	evictIfNeeded();
	return entry;
}

/**
 * Kysely instance for the SOURCE DB (block/tx/event reads from the shared
 * indexer). Resolution: `SOURCE_DATABASE_URL || DATABASE_URL`.
 */
export function getSourceDb(): Kysely<Database> {
	return getOrCreatePool(resolveSourceUrl()).db;
}

/**
 * Kysely instance for the TARGET DB (subgraph schemas, subgraphs table,
 * account-scoped data — tenant-side writes). Resolution:
 * `TARGET_DATABASE_URL || DATABASE_URL`.
 */
export function getTargetDb(): Kysely<Database> {
	return getOrCreatePool(resolveTargetUrl()).db;
}

/**
 * Backward-compat alias for `getTargetDb()`. Accepts an optional
 * `connectionString` override used by seed/test helpers — when supplied,
 * bypasses env resolution and uses the provided URL directly (still cached).
 */
export function getDb(connectionString?: string): Kysely<Database> {
	if (connectionString) return getOrCreatePool(connectionString).db;
	return getTargetDb();
}

/**
 * Raw postgres.js client for dynamic schema DDL (CREATE SCHEMA, DROP, etc.).
 * Defaults to the target role (tenant schemas live in the target DB).
 */
export function getRawClient(
	role: "source" | "target" = "target",
): ReturnType<typeof postgres> {
	const url = role === "source" ? resolveSourceUrl() : resolveTargetUrl();
	return getOrCreatePool(url).rawClient;
}

/**
 * Raw postgres.js client for an arbitrary connection string (cached by URL).
 * Used by the BYO data plane to run DDL / serving queries against a
 * user-owned Postgres. Distinct from {@link getRawClient}, which only knows the
 * source/target roles resolved from env.
 */
export function getRawClientFor(url: string): ReturnType<typeof postgres> {
	return getOrCreatePool(url).rawClient;
}

/** Close all DB connection pools. Call in CLI commands to allow process exit. */
export async function closeDb(): Promise<void> {
	for (const entry of pools.values()) {
		await entry.db.destroy();
		await entry.rawClient.end();
	}
	pools.clear();
}

import { sql } from "kysely";
export { sql };
export * from "./types.ts";
export type { DbReadRow, NumericAsText } from "./read-row.ts";
export { SOURCE_READ_COLUMNS } from "./source-read-columns.ts";
export { jsonb, parseJsonb } from "./jsonb.ts";
export {
	getMigrationRole,
	onChainPlane,
	onControlPlane,
	setMigrationRole,
} from "./migration-role.ts";
export type { MigrationRole } from "./migration-role.ts";
export { TABLE_TO_DB } from "./table-plane.ts";
export type { DbPlane } from "./table-plane.ts";
