import { type Kysely, sql } from "kysely";
import type postgres from "postgres";
import { decryptSecret, encryptSecret } from "../../crypto/secrets.ts";
import { getDb, getRawClient, getRawClientFor, getTargetDb } from "../index.ts";
import { jsonb } from "../jsonb.ts";
import type { Database, Subgraph } from "../types.ts";

/**
 * BYO data plane helpers. A subgraph's user-owned Postgres connection string is
 * stored encrypted at rest in `database_url_enc` (AES-GCM envelope). Plaintext
 * only exists transiently — at deploy (to encrypt) and at pool construction (to
 * connect). Never serialize it into API responses.
 */
export function encryptDatabaseUrl(url: string): Buffer {
	return encryptSecret(url);
}

/** Decrypt a subgraph's BYO connection string, or null when managed. */
export function subgraphDatabaseUrl(subgraph: Subgraph): string | null {
	return subgraph.database_url_enc
		? decryptSecret(subgraph.database_url_enc)
		: null;
}

/** True when the subgraph writes/serves from a user-owned DB. */
export function isByoSubgraph(subgraph: Subgraph): boolean {
	return subgraph.database_url_enc != null;
}

/**
 * Resolve the Kysely instance a subgraph's data plane lives on: the user's DB
 * when BYO, else the managed target DB. Pools are cached by URL in db/index.ts.
 */
export function resolveSubgraphDb(subgraph: Subgraph): Kysely<Database> {
	const url = subgraphDatabaseUrl(subgraph);
	return url ? getDb(url) : getTargetDb();
}

/** Raw postgres.js client for a subgraph's data plane (DDL / serving queries). */
export function resolveSubgraphRawClient(
	subgraph: Subgraph,
): ReturnType<typeof postgres> {
	const url = subgraphDatabaseUrl(subgraph);
	return url ? getRawClientFor(url) : getRawClient("target");
}

/**
 * Convert a subgraph name to its PostgreSQL schema name (legacy form).
 * Pre shared-rip every tenant DB had its own schema namespace so disambiguation
 * was implicit. Kept for oss mode (single-tenant) and legacy-row fallback.
 * Platform-mode deploys use `pgSchemaNameFor(accountId, name)`.
 */
export function pgSchemaName(subgraphName: string): string {
	const safeName = subgraphName.replace(/-/g, "_");
	return `subgraph_${safeName}`;
}

/**
 * Account-scoped schema name. Matches migration 0028's rename pattern:
 *   subgraph_{first8charsOfAccountId, dashes-as-underscores}_{name}
 * Empty accountId falls back to legacy form (oss mode).
 */
export function pgSchemaNameFor(
	accountId: string,
	subgraphName: string,
): string {
	if (!accountId) return pgSchemaName(subgraphName);
	const accountPrefix = accountId.slice(0, 8).replace(/-/g, "_");
	const safeName = subgraphName.replace(/-/g, "_");
	return `subgraph_${accountPrefix}_${safeName}`;
}

export async function registerSubgraph(
	db: Kysely<Database>,
	data: {
		name: string;
		version: string;
		definition: Record<string, unknown>;
		schemaHash: string;
		handlerPath: string;
		apiKeyId?: string;
		accountId?: string;
		schemaName?: string;
		startBlock?: number;
		handlerCode?: string;
		sourceCode?: string;
		/** BYO data plane: encrypted user-DB connection string, or null = managed. */
		databaseUrlEnc?: Buffer | null;
	},
): Promise<Subgraph> {
	return await db
		.insertInto("subgraphs")
		.values({
			name: data.name,
			version: data.version,
			definition: jsonb<Record<string, unknown>>(data.definition),
			schema_hash: data.schemaHash,
			handler_path: data.handlerPath,
			account_id: data.accountId ?? "",
			handler_code: data.handlerCode ?? null,
			source_code: data.sourceCode ?? null,
			schema_name: data.schemaName ?? null,
			start_block: data.startBlock ?? 0,
			database_url_enc: data.databaseUrlEnc ?? null,
		})
		.onConflict((oc) =>
			oc.columns(["name", "account_id"]).doUpdateSet({
				version: data.version,
				definition: jsonb<Record<string, unknown>>(data.definition),
				schema_hash: data.schemaHash,
				handler_path: data.handlerPath,
				handler_code: data.handlerCode ?? null,
				source_code: data.sourceCode ?? null,
				schema_name: data.schemaName ?? null,
				start_block: data.startBlock ?? 0,
				database_url_enc: data.databaseUrlEnc ?? null,
				updated_at: new Date(),
			}),
		)
		.returningAll()
		.executeTakeFirstOrThrow();
}

export async function getSubgraph(
	db: Kysely<Database>,
	name: string,
	accountId?: string,
): Promise<Subgraph | null> {
	let query = db.selectFrom("subgraphs").selectAll().where("name", "=", name);

	if (accountId !== undefined) {
		query = query.where("account_id", "=", accountId);
	}

	return (await query.executeTakeFirst()) ?? null;
}

export async function listSubgraphs(
	db: Kysely<Database>,
	accountId?: string,
): Promise<Subgraph[]> {
	let query = db.selectFrom("subgraphs").selectAll();
	if (accountId !== undefined) {
		query = query.where("account_id", "=", accountId);
	}
	return query.execute();
}

/**
 * Resolve a public subgraph by name. Public names are a single global
 * namespace (partial unique index `subgraphs_public_name_uidx`), so at most
 * one row matches regardless of account.
 */
export async function findPublicSubgraphByName(
	db: Kysely<Database>,
	name: string,
): Promise<Subgraph | null> {
	return (
		(await db
			.selectFrom("subgraphs")
			.selectAll()
			.where("name", "=", name)
			.where("visibility", "=", "public")
			.executeTakeFirst()) ?? null
	);
}

export async function updateSubgraphVisibility(
	db: Kysely<Database>,
	name: string,
	accountId: string,
	visibility: "public" | "private",
): Promise<void> {
	await db
		.updateTable("subgraphs")
		.set({ visibility, updated_at: new Date() })
		.where("name", "=", name)
		.where("account_id", "=", accountId)
		.execute();
}

export async function updateSubgraphStatus(
	db: Kysely<Database>,
	name: string,
	status: string,
	lastProcessedBlock?: number,
): Promise<void> {
	await db
		.updateTable("subgraphs")
		.set({
			status,
			...(lastProcessedBlock !== undefined
				? { last_processed_block: lastProcessedBlock }
				: {}),
			updated_at: new Date(),
		})
		.where("name", "=", name)
		.execute();
}

export async function recordSubgraphProcessed(
	db: Kysely<Database>,
	name: string,
	processed: number,
	errors: number,
	lastError?: string,
): Promise<void> {
	await db
		.updateTable("subgraphs")
		.set({
			total_processed: sql`total_processed + ${processed}`,
			total_errors: sql`total_errors + ${errors}`,
			...(lastError
				? { last_error: lastError, last_error_at: new Date() }
				: {}),
			updated_at: new Date(),
		})
		.where("name", "=", name)
		.execute();
}

export async function updateSubgraphHandlerPath(
	db: Kysely<Database>,
	name: string,
	handlerPath: string,
	opts?: { handlerCode?: string; sourceCode?: string },
): Promise<void> {
	await db
		.updateTable("subgraphs")
		.set({
			handler_path: handlerPath,
			...(opts?.handlerCode != null ? { handler_code: opts.handlerCode } : {}),
			...(opts?.sourceCode != null ? { source_code: opts.sourceCode } : {}),
			updated_at: new Date(),
		})
		.where("name", "=", name)
		.execute();
}

export async function deleteSubgraph(
	db: Kysely<Database>,
	name: string,
	accountId?: string,
): Promise<Subgraph | null> {
	const subgraph = await getSubgraph(db, name, accountId);
	if (!subgraph) return null;

	// Use stored schema_name if available, otherwise compute
	const schemaName = subgraph.schema_name ?? pgSchemaName(name);

	// Cascade to subscriptions: a subscription pointing at a deleted
	// subgraph + table will throw `relation does not exist` on every
	// subsequent emission. Pause active subs and purge any pending outbox
	// rows so receivers don't get phantom replays. We don't delete the
	// subscriptions themselves — operators may want to repoint them at a
	// resurrected subgraph; we just stop them firing.
	await db
		.updateTable("subscriptions")
		.set({
			status: "paused",
			last_error: `Subgraph "${name}" deleted; subscription auto-paused.`,
			updated_at: new Date(),
		})
		.where("subgraph_name", "=", name)
		.execute();
	await db
		.deleteFrom("subscription_outbox")
		.where("status", "=", "pending")
		.where("subscription_id", "in", (qb) =>
			qb
				.selectFrom("subscriptions")
				.select("id")
				.where("subgraph_name", "=", name),
		)
		.execute();

	// Drop the subgraph's schema (CASCADE drops all tables within). For BYO the
	// schema lives in the user's DB — we deliberately do NOT connect there to
	// drop their data on delete; deleting the subgraph just removes our registry
	// row (and, with it, the encrypted connection) + pauses subscriptions. The
	// user drops the schema themselves if they want it gone.
	if (!isByoSubgraph(subgraph)) {
		await sql`DROP SCHEMA IF EXISTS ${sql.raw(`"${schemaName}"`)} CASCADE`.execute(
			db,
		);
	}

	// Remove from registry (the inline database_url_enc envelope goes with it)
	await db.deleteFrom("subgraphs").where("id", "=", subgraph.id).execute();

	return subgraph;
}

/** Set or clear a paid subgraph's expiry (NULL = no expiry, e.g. on claim). */
export async function updateSubgraphExpiry(
	db: Kysely<Database>,
	name: string,
	accountId: string,
	expiresAt: Date | null,
): Promise<void> {
	await db
		.updateTable("subgraphs")
		.set({ expires_at: expiresAt })
		.where("name", "=", name)
		.where("account_id", "=", accountId)
		.execute();
}
