import type { Kysely } from "kysely";
import type { BootstrapSource, SyncScope } from "../../coverage/evaluate.ts";
import type { Database } from "../types.ts";

/**
 * The instance's declared sync scope.
 *
 * An instance that starts at height N is not an instance missing the first N
 * blocks — but nothing in the schema said so, so every consumer had to guess
 * from `MIN(height)`. `sync_scopes` records the declaration; this module is the
 * only place that reads it, and it always answers in the `SyncScope` shape the
 * coverage evaluator consumes.
 *
 * `resolveSyncScope` never fails on an instance that predates the table: with
 * no row it derives a scope from what the database already shows, so an
 * existing install keeps working without a backfill dance.
 */

/**
 * Declares a forward-only instance: history below this height is deliberately
 * absent, not lost. Read only when no `sync_scopes` row exists — a recorded
 * scope always wins, because it is the one an operator committed to.
 */
export const SYNC_START_HEIGHT_ENV = "SECONDLAYER_SYNC_START_HEIGHT";

export class InvalidSyncStartHeightError extends Error {
	readonly name = "InvalidSyncStartHeightError";
	constructor(readonly value: string) {
		super(
			`${SYNC_START_HEIGHT_ENV} must be a non-negative integer (got ${value})`,
		);
	}
}

/**
 * Throws rather than ignoring a malformed value: a typo'd start height that
 * silently falls back to genesis would report a real forward-only instance as
 * an 8M-block gap, which is the exact confusion this table exists to end.
 */
export function syncStartHeightFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): number | null {
	const raw = env[SYNC_START_HEIGHT_ENV];
	if (raw === undefined || raw.trim() === "") return null;
	const height = Number(raw.trim());
	if (!Number.isInteger(height) || height < 0) {
		throw new InvalidSyncStartHeightError(raw);
	}
	return height;
}

function toScope(row: {
	network: string;
	start_height: number | string;
	target_height: number | string | null;
	bootstrap_source: BootstrapSource;
	bootstrap_manifest_digest: string | null;
	genesis_hash: string | null;
}): SyncScope {
	return {
		network: row.network,
		start_height: Number(row.start_height),
		target_height:
			row.target_height === null ? null : Number(row.target_height),
		bootstrap: {
			source: row.bootstrap_source,
			manifest_digest: row.bootstrap_manifest_digest,
			genesis_hash: row.genesis_hash,
		},
	};
}

export async function getSyncScope(
	db: Kysely<Database>,
	network: string,
): Promise<SyncScope | null> {
	const row = await db
		.selectFrom("sync_scopes")
		.select([
			"network",
			"start_height",
			"target_height",
			"bootstrap_source",
			"bootstrap_manifest_digest",
			"genesis_hash",
		])
		.where("network", "=", network)
		.executeTakeFirst();
	return row ? toScope(row) : null;
}

/**
 * Record (or restate) the scope for a network. Bootstrap and re-bootstrap are
 * the writers; the upsert is idempotent so re-running a restore over the same
 * archive does not fork the declaration.
 */
export async function upsertSyncScope(
	db: Kysely<Database>,
	scope: SyncScope,
): Promise<SyncScope> {
	const row = await db
		.insertInto("sync_scopes")
		.values({
			network: scope.network,
			start_height: scope.start_height,
			target_height: scope.target_height,
			bootstrap_source: scope.bootstrap.source,
			bootstrap_manifest_digest: scope.bootstrap.manifest_digest,
			genesis_hash: scope.bootstrap.genesis_hash,
		})
		.onConflict((oc) =>
			oc.column("network").doUpdateSet({
				start_height: scope.start_height,
				target_height: scope.target_height,
				bootstrap_source: scope.bootstrap.source,
				bootstrap_manifest_digest: scope.bootstrap.manifest_digest,
				genesis_hash: scope.bootstrap.genesis_hash,
				updated_at: new Date(),
			}),
		)
		.returning([
			"network",
			"start_height",
			"target_height",
			"bootstrap_source",
			"bootstrap_manifest_digest",
			"genesis_hash",
		])
		.executeTakeFirstOrThrow();
	return toScope(row);
}

/**
 * The persisted scope, or one derived from the database when none was ever
 * recorded.
 *
 * The derivation is deliberately conservative: it claims only what the data
 * already shows (the lowest canonical block, the genesis hash if genesis is
 * present) and never invents provenance — an instance whose history starts
 * above genesis with no recorded bootstrap is an `import`, not an archive
 * restore we can vouch for.
 */
export async function resolveSyncScope(
	db: Kysely<Database>,
	network: string,
): Promise<SyncScope> {
	const persisted = await getSyncScope(db, network);
	if (persisted) return persisted;

	const declaredStart = syncStartHeightFromEnv();
	const lowest = await db
		.selectFrom("blocks")
		.select(({ fn }) => fn.min("height").as("min"))
		.where("canonical", "=", true)
		.executeTakeFirst();
	const lowestStored =
		lowest?.min === null || lowest?.min === undefined
			? null
			: Number(lowest.min);
	const startHeight = declaredStart ?? lowestStored ?? 0;

	const genesis =
		startHeight === 0
			? await db
					.selectFrom("blocks")
					.select("hash")
					.where("canonical", "=", true)
					.where("height", "=", 0)
					.executeTakeFirst()
			: undefined;

	return {
		network,
		start_height: startHeight,
		target_height: null,
		bootstrap: {
			source: startHeight === 0 ? "genesis" : "import",
			manifest_digest: null,
			genesis_hash: genesis?.hash ?? null,
		},
	};
}
