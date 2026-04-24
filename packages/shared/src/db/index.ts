import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { logger } from "../logger.ts";
import type { Database } from "./types.ts";

const DEFAULT_URL =
	"postgres://postgres:postgres@localhost:5432/secondlayer_dev";

interface PoolEntry {
	db: Kysely<Database>;
	rawClient: ReturnType<typeof postgres>;
}

/**
 * Cache of Kysely + raw postgres.js pools keyed by resolved URL.
 * Two getters resolving to the same URL share one entry (single pool) —
 * this is the single-DB backward-compat contract: when only `DATABASE_URL`
 * is set, `getSourceDb() === getTargetDb()` (zero regression vs. pre-dual-DB).
 */
const pools = new Map<string, PoolEntry>();

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

function getOrCreatePool(url: string): PoolEntry {
	const existing = pools.get(url);
	if (existing) return existing;

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
	const rawClient = postgres(url, {
		max: poolMax,
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
	const entry: PoolEntry = { db, rawClient };
	pools.set(url, entry);
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
export { jsonb, parseJsonb } from "./jsonb.ts";
