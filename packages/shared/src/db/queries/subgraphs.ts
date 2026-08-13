import { type Kysely, sql } from "kysely";
import type postgres from "postgres";
import { decryptSecret, encryptSecret } from "../../crypto/secrets.ts";
import { isPlatformMode } from "../../mode.ts";
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

/** OSS writes empty account_id — name is the local unique key. */
export function localSubgraphAccountId(accountId?: string): string {
	if (!isPlatformMode()) return "";
	return accountId ?? "";
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
	const accountId = localSubgraphAccountId(data.accountId);
	const values = {
		name: data.name,
		version: data.version,
		definition: jsonb<Record<string, unknown>>(data.definition),
		schema_hash: data.schemaHash,
		handler_path: data.handlerPath,
		account_id: accountId,
		handler_code: data.handlerCode ?? null,
		source_code: data.sourceCode ?? null,
		schema_name: data.schemaName ?? null,
		start_block: data.startBlock ?? 0,
		database_url_enc: data.databaseUrlEnc ?? null,
	};
	const updateSet = {
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
	};

	// OSS: name is unique. Upsert by name so leftover rows with a non-empty
	// account_id (pre-local-namespace deploys) don't insert a second row.
	if (!isPlatformMode()) {
		const existing = await db
			.selectFrom("subgraphs")
			.select("id")
			.where("name", "=", data.name)
			.executeTakeFirst();
		if (existing) {
			return await db
				.updateTable("subgraphs")
				.set({ ...updateSet, account_id: "" })
				.where("id", "=", existing.id)
				.returningAll()
				.executeTakeFirstOrThrow();
		}
		return await db
			.insertInto("subgraphs")
			.values(values)
			.returningAll()
			.executeTakeFirstOrThrow();
	}

	return await db
		.insertInto("subgraphs")
		.values(values)
		.onConflict((oc) =>
			oc.columns(["name", "account_id"]).doUpdateSet(updateSet),
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

	if (isPlatformMode() && accountId !== undefined) {
		query = query.where("account_id", "=", accountId);
	}

	return (await query.executeTakeFirst()) ?? null;
}

export async function listSubgraphs(
	db: Kysely<Database>,
	accountId?: string,
): Promise<Subgraph[]> {
	let query = db.selectFrom("subgraphs").selectAll();
	if (isPlatformMode() && accountId !== undefined) {
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

/** Live-walk ERROR write (f069): a block whose handlers ALL failed
 *  (`processed === 0 && errors > 0`, `block-processor.ts`'s `applyProgress`)
 *  is stamped 'error' and its height is recorded as processed, same as
 *  `updateSubgraphStatus(db, name, "error", blockHeight)` — except the
 *  cursor half of that write now goes through the same conditional `<`
 *  guard as {@link recordLiveProgress}. Marking a subgraph 'error' is not
 *  itself replay-sensitive, but it shares the `last_processed_block` column
 *  with the replay guard: an unconditional write here could regress the
 *  cursor a racing (successful) writer already advanced past, which is
 *  exactly the regress-then-re-walk loop this guard exists to close. In
 *  practice `ctx.rollbackTo` (`runner.ts`) means an all-failed block never
 *  flushes writes, so a lost race here is always a silent no-op, never a
 *  case that needs `CursorRaceLostError`-style tx abort. Returns whether
 *  the write applied. Live path only — reindex/backfill's error stamping
 *  goes through {@link updateSubgraphStatus} unconditionally, as before. */
export async function recordLiveError(
	db: Kysely<Database>,
	name: string,
	blockHeight: number,
): Promise<boolean> {
	const result = await db
		.updateTable("subgraphs")
		.set({
			status: "error",
			last_processed_block: blockHeight,
			updated_at: new Date(),
		})
		.where("name", "=", name)
		.where("last_processed_block", "<", blockHeight)
		.executeTakeFirst();
	return Number(result.numUpdatedRows ?? 0n) > 0;
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

/** Live-walk progress write: advances the cursor and PROMOTES toward
 *  'active' (deploying/error → active keeps reorg eligibility, reorg.ts gates
 *  on it) but never overwrites an explicit 'reindexing' park — unconditional
 *  status stamping let catch-up flap a parked subgraph back into its own path
 *  per block, fighting the queued reindex op.
 *
 *  `last_processed_block` is now written CONDITIONALLY — `WHERE
 *  last_processed_block < lastProcessedBlock`, mirroring
 *  `advanceOperationCursor`'s (`subgraph-operations.ts`) comparison shape —
 *  and returns whether THIS call actually advanced it. This used to be
 *  unconditional by design, on the premise that the only two writers able to
 *  advance/rewind a given subgraph's cursor concurrently (the catch-up walk
 *  and the reorg handler) serialize on an in-process per-subgraph lock +
 *  reorg epoch guard (`packages/subgraphs/src/runtime/catchup.ts`,
 *  `subgraphBlockLockHeld` / `reorgEpoch`; f057). That guard is in-process
 *  only. The f068 investigation
 *  (`docs/internal/audits/asset-holdings-unreproducible-balances-f068.md`)
 *  found a cross-process sequence it does not cover: a catch-up leader that
 *  loses its advisory-lock connection mid-walk keeps writing (leadership is
 *  checked only at walk entry, not per-iteration) while a new leader takes
 *  over and walks the same range — both commit increments for overlapping
 *  heights, and every regressed cursor write from the laggard re-triggers a
 *  full re-walk, growing per-height application without bound. The
 *  conditional advance here (paired with the fast-path replay guard armed on
 *  the live path in `block-processor.ts`) is now the cross-process
 *  guarantee: a block at/below the current cursor can never re-advance it,
 *  so a laggard's commits can no longer regress-then-retrigger.
 *
 *  This conditionality is why the reorg rewind can no longer go through this
 *  function — a rewind's whole point is to move the cursor *backward*, which
 *  the `<` guard would silently refuse. Reorg mode calls
 *  {@link rewindLiveProgress} instead, which keeps the old unconditional
 *  semantics and is safe specifically because the reorg path takes a
 *  transaction-scoped advisory lock (`reorg.ts`) other writers can't cross. */
export async function recordLiveProgress(
	db: Kysely<Database>,
	name: string,
	lastProcessedBlock: number,
): Promise<boolean> {
	const result = await db
		.updateTable("subgraphs")
		.set({
			last_processed_block: lastProcessedBlock,
			status: sql`CASE WHEN status = 'reindexing' THEN status ELSE 'active' END`,
			updated_at: new Date(),
		})
		.where("name", "=", name)
		.where("last_processed_block", "<", lastProcessedBlock)
		.executeTakeFirst();
	return Number(result.numUpdatedRows ?? 0n) > 0;
}

/** Reorg-rewind progress write: the OLD unconditional `recordLiveProgress`
 *  semantics, verbatim — moves `last_processed_block` to the fork height
 *  regardless of its current value, because that is by definition a
 *  backward move the conditional `<` guard in `recordLiveProgress` would
 *  refuse. Same status-promotion CASE (never unparks an explicit
 *  'reindexing').
 *
 *  Callers: exclusively the subgraph-reorg path
 *  (`packages/subgraphs/src/runtime/reorg.ts`, via `block-processor.ts`'s
 *  `reorgRewind` mode), which is safe from the cross-process race this
 *  function reintroduces because it holds a transaction-scoped Postgres
 *  advisory lock (`pg_advisory_xact_lock`) for the whole
 *  delete+reprocess+rewind sequence — no other writer can interleave a
 *  forward write between the rewind and the fork block's reprocess. Do not
 *  call this from the live catch-up path. */
export async function rewindLiveProgress(
	db: Kysely<Database>,
	name: string,
	lastProcessedBlock: number,
): Promise<void> {
	await db
		.updateTable("subgraphs")
		.set({
			last_processed_block: lastProcessedBlock,
			status: sql`CASE WHEN status = 'reindexing' THEN status ELSE 'active' END`,
			updated_at: new Date(),
		})
		.where("name", "=", name)
		.execute();
}
