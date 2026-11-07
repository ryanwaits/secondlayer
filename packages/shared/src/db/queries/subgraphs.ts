import { type Kysely, sql } from "kysely";
import { isPlatformMode } from "../../mode.ts";
import {
	SUBGRAPH_STATES,
	type SubgraphStatus,
	type SubgraphVerification,
} from "../../schemas/subgraphs.ts";
import { jsonb } from "../jsonb.ts";
import { type Machine, casTransition, defineMachine } from "../transition.ts";
import type { Database, Subgraph } from "../types.ts";

/**
 * Subgraph lifecycle. `error` is sticky: a live walk never clears it, only a
 * redeploy (`error -> active`) or a reindex (`error -> reindexing`) does.
 * Every status write goes through {@link transitionSubgraph}; the live
 * progress writes below touch the cursor only and are gated on the status
 * they are valid for.
 */
export const subgraphMachine: Machine<SubgraphStatus> = defineMachine({
	states: SUBGRAPH_STATES,
	transitions: {
		active: ["reindexing", "error"],
		reindexing: ["active", "error"],
		error: ["reindexing", "active"],
	},
});

/**
 * Move a subgraph from one of `from` to `to`, writing `set` in the same
 * statement. Returns the row, or `null` when it was not in a `from` state
 * (something else, a halt or a redeploy, decided first): log and stop, never
 * retry. Staying in the same state (`reindexing -> reindexing`) is a plain
 * conditional write, not a transition.
 */
export function transitionSubgraph(
	db: Kysely<Database>,
	name: string,
	from: readonly SubgraphStatus[],
	to: SubgraphStatus,
	set?: Record<string, unknown>,
): Promise<Subgraph | null> {
	for (const state of from) {
		if (state !== to) subgraphMachine.assert(state, to);
	}
	return casTransition<SubgraphStatus, Subgraph>(db, {
		table: "subgraphs",
		key: "name",
		id: name,
		from,
		to,
		set,
	});
}

/** Convert a subgraph name to its PostgreSQL schema name. */
export function pgSchemaName(subgraphName: string): string {
	const safeName = subgraphName.replace(/-/g, "_");
	return `subgraph_${safeName}`;
}

/** OSS writes empty account_id — name is the local unique key. */
export function localSubgraphAccountId(accountId?: string): string {
	if (!isPlatformMode()) return "";
	return accountId ?? "";
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
		pin?: string | null;
		pinPreimage?: string | null;
		verification?: SubgraphVerification | null;
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
		pin: data.pin ?? null,
		pin_preimage: data.pinPreimage ?? null,
		verification: data.verification
			? jsonb<SubgraphVerification>(data.verification)
			: null,
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
		pin: values.pin,
		pin_preimage: values.pin_preimage,
		verification: values.verification,
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

/** The hash half of a cursor write. Absent when the caller has none; the
 *  `subgraphs_clear_stale_block_hash` trigger (0197) then clears the stored hash
 *  for a moved cursor instead of leaving one that names another block. */
function cursorHash(blockHash: string | undefined) {
	return blockHash === undefined
		? {}
		: { last_processed_block_hash: blockHash };
}

/**
 * Reindex progress: moves the cursor of a subgraph that is still
 * `reindexing`, and nothing else. Returns `false` when the subgraph left that
 * state (halted, cancelled, redeployed): the walk must not write on, and its
 * progress never revives a halt.
 */
export async function setReindexCursor(
	db: Kysely<Database>,
	name: string,
	lastProcessedBlock: number,
	blockHash?: string,
): Promise<boolean> {
	const result = await db
		.updateTable("subgraphs")
		.set({
			last_processed_block: lastProcessedBlock,
			...cursorHash(blockHash),
			updated_at: new Date(),
		})
		.where("name", "=", name)
		.where("status", "=", "reindexing")
		.executeTakeFirst();
	return Number(result.numUpdatedRows ?? 0n) > 0;
}

/** Live-walk ERROR write (f069): a block whose handlers ALL failed
 *  (`processed === 0 && errors > 0`, `block-processor.ts`'s `applyProgress`)
 *  moves an `active` subgraph to 'error' and records its height as processed;
 *  the cursor half goes through the same conditional `<` guard as
 *  {@link recordLiveProgress}. A reindexing or already-halted subgraph is left
 *  alone. Marking a subgraph 'error' is not
 *  itself replay-sensitive, but it shares the `last_processed_block` column
 *  with the replay guard: an unconditional write here could regress the
 *  cursor a racing (successful) writer already advanced past, which is
 *  exactly the regress-then-re-walk loop this guard exists to close. In
 *  practice `ctx.rollbackTo` (`runner.ts`) means an all-failed block never
 *  flushes writes, so a lost race here is always a silent no-op, never a
 *  case that needs `CursorRaceLostError`-style tx abort. Returns whether
 *  the write applied. Live path only: reindex/backfill halts go through
 *  {@link transitionSubgraph}. */
export async function recordLiveError(
	db: Kysely<Database>,
	name: string,
	blockHeight: number,
	blockHash?: string,
): Promise<boolean> {
	const result = await db
		.updateTable("subgraphs")
		.set({
			status: "error",
			last_processed_block: blockHeight,
			...cursorHash(blockHash),
			updated_at: new Date(),
		})
		.where("name", "=", name)
		.where("status", "=", "active")
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

/** Record a billing pause. Status, cursor, counters and `last_error` are
 *  untouched: a paused subgraph is healthy, just waiting on its account. */
export async function markSubgraphBillingPaused(
	db: Kysely<Database>,
	name: string,
	code: string,
): Promise<void> {
	await db
		.updateTable("subgraphs")
		.set({
			billing_paused_at: sql`COALESCE(billing_paused_at, now())`,
			billing_paused_code: code,
			updated_at: new Date(),
		})
		.where("name", "=", name)
		.execute();
}

/** Clear a billing pause once reads succeed again. */
export async function clearSubgraphBillingPaused(
	db: Kysely<Database>,
	name: string,
): Promise<void> {
	await db
		.updateTable("subgraphs")
		.set({
			billing_paused_at: null,
			billing_paused_code: null,
			updated_at: new Date(),
		})
		.where("name", "=", name)
		.where("billing_paused_at", "is not", null)
		.execute();
}

export async function updateSubgraphHandlerPath(
	db: Kysely<Database>,
	name: string,
	handlerPath: string,
	opts?: {
		handlerCode?: string;
		sourceCode?: string;
		pin?: string | null;
		pinPreimage?: string | null;
		verification?: SubgraphVerification | null;
	},
): Promise<void> {
	await db
		.updateTable("subgraphs")
		.set({
			handler_path: handlerPath,
			...(opts?.handlerCode != null ? { handler_code: opts.handlerCode } : {}),
			...(opts?.sourceCode != null ? { source_code: opts.sourceCode } : {}),
			...(opts?.pin !== undefined ? { pin: opts.pin } : {}),
			...(opts?.pinPreimage !== undefined
				? { pin_preimage: opts.pinPreimage }
				: {}),
			...(opts?.verification !== undefined
				? {
						verification: opts.verification
							? jsonb<SubgraphVerification>(opts.verification)
							: null,
					}
				: {}),
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

	// Drop the subgraph's schema (CASCADE drops all tables within).
	await sql`DROP SCHEMA IF EXISTS ${sql.raw(`"${schemaName}"`)} CASCADE`.execute(
		db,
	);

	// Remove from registry
	await db.deleteFrom("subgraphs").where("id", "=", subgraph.id).execute();

	return subgraph;
}

/** Live-walk progress write: advances the cursor of an `active` subgraph and
 *  never touches status. A `reindexing` or `error` subgraph is a no-op here:
 *  the old promote-toward-active CASE let a live commit undo a halt and flap
 *  a parked subgraph back into catch-up against its own reindex op.
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
	blockHash?: string,
): Promise<boolean> {
	const result = await db
		.updateTable("subgraphs")
		.set({
			last_processed_block: lastProcessedBlock,
			...cursorHash(blockHash),
			updated_at: new Date(),
		})
		.where("name", "=", name)
		.where("status", "=", "active")
		.where("last_processed_block", "<", lastProcessedBlock)
		.executeTakeFirst();
	return Number(result.numUpdatedRows ?? 0n) > 0;
}

/** Reorg-rewind progress write: the OLD unconditional `recordLiveProgress`
 *  semantics, verbatim — moves `last_processed_block` to the fork height
 *  regardless of its current value, because that is by definition a
 *  backward move the conditional `<` guard in `recordLiveProgress` would
 *  refuse. Cursor only, `active` subgraphs only.
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
	blockHash?: string,
): Promise<void> {
	await db
		.updateTable("subgraphs")
		.set({
			last_processed_block: lastProcessedBlock,
			...cursorHash(blockHash),
			updated_at: new Date(),
		})
		.where("name", "=", name)
		.where("status", "=", "active")
		.execute();
}
