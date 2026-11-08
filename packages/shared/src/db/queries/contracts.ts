import { type Kysely, sql } from "kysely";
import { jsonb } from "../jsonb.ts";
import { type Machine, casTransition, defineMachine } from "../transition.ts";
import {
	ABI_STATUSES,
	type AbiStatus,
	type Contract,
	type Database,
} from "../types.ts";

/**
 * Contract registry queries — backing for trait-based discovery. Populated from
 * contract deploys; ABI fetched async; standards inferred by static analysis.
 */

export type { AbiStatus };

/**
 * Record a contract deploy (idempotent). ABI is fetched separately + async.
 * On conflict the row is re-canonicalized rather than skipped: after a reorg
 * flips contracts non-canonical (markContractsNonCanonical), discovery
 * re-selects any id whose deploy tx exists on the new fork and this upsert
 * restores `canonical` with the fork's height. ABI fields are untouched, so a
 * previously fetched ABI survives the round trip.
 */
export async function recordContractDeploy(
	db: Kysely<Database>,
	row: { contractId: string; deployer: string; blockHeight: number },
): Promise<void> {
	await db
		.insertInto("contracts")
		.values({
			contract_id: row.contractId,
			deployer: row.deployer,
			block_height: row.blockHeight,
		})
		.onConflict((oc) =>
			oc.column("contract_id").doUpdateSet({
				deployer: row.deployer,
				block_height: row.blockHeight,
				canonical: true,
			}),
		)
		.execute();
}

/**
 * ABI fetch lifecycle. `failed` is retryable: a transient RPC error must not
 * strand a contract. Each failure backs off (see {@link abiRetryDelayMs}) and
 * after {@link ABI_MAX_ATTEMPTS} failures the row stays `failed` for good.
 */
export const ABI_MACHINE: Machine<AbiStatus> = defineMachine({
	states: ABI_STATUSES,
	transitions: {
		pending: ["fetched", "unparseable", "failed"],
		failed: ["fetched", "unparseable", "failed"],
	},
});

export const ABI_MAX_ATTEMPTS = 5;
const ABI_RETRY_BASE_MS = 15 * 60 * 1000;

/** Wait before the next fetch after `attempts` failures: 30 min, 1 h, 2 h, 4 h. */
export function abiRetryDelayMs(attempts: number): number {
	return ABI_RETRY_BASE_MS * 2 ** Math.max(1, attempts);
}

/**
 * Store a fetched ABI + the traits/standards derived from it. Moves a
 * `pending` or retried `failed` row only; `null` means another writer got
 * there first.
 */
export async function setContractAbi(
	db: Kysely<Database>,
	contractId: string,
	data: {
		abi: unknown | null;
		status: Extract<AbiStatus, "fetched" | "unparseable">;
		declaredTraits?: string[];
		inferredStandards?: string[];
	},
): Promise<boolean> {
	const row = await casTransition(db, {
		table: "contracts",
		key: "contract_id",
		column: "abi_status",
		id: contractId,
		from: ["pending", "failed"],
		to: data.status,
		stampUpdatedAt: false,
		set: {
			abi: data.abi == null ? null : jsonb(data.abi),
			abi_fetched_at: new Date(),
			...(data.declaredTraits ? { declared_traits: data.declaredTraits } : {}),
			...(data.inferredStandards
				? { inferred_standards: data.inferredStandards }
				: {}),
		},
	});
	return row !== null;
}

/**
 * Record a failed ABI fetch: bump `abi_attempts` and schedule the retry, or
 * stop scheduling once attempts run out.
 */
export async function recordAbiFetchFailure(
	db: Kysely<Database>,
	contractId: string,
	now: Date = new Date(),
): Promise<boolean> {
	const current = await db
		.selectFrom("contracts")
		.select("abi_attempts")
		.where("contract_id", "=", contractId)
		.executeTakeFirst();
	if (!current) return false;
	const attempts = Number(current.abi_attempts) + 1;
	const row = await casTransition(db, {
		table: "contracts",
		key: "contract_id",
		column: "abi_status",
		id: contractId,
		from: ["pending", "failed"],
		to: "failed",
		stampUpdatedAt: false,
		set: {
			abi_attempts: attempts,
			abi_next_attempt_at:
				attempts >= ABI_MAX_ATTEMPTS
					? null
					: new Date(now.getTime() + abiRetryDelayMs(attempts)),
		},
	});
	return row !== null;
}

/**
 * Re-classification: replace a contract's inferred standards. Bumps
 * `abi_fetched_at`, which /v1/contracts serves as `classified_at` (hosted
 * tenants poll `classified_after`), so changed rows reach them.
 */
export async function setInferredStandards(
	db: Kysely<Database>,
	contractId: string,
	inferred: string[],
): Promise<void> {
	await db
		.updateTable("contracts")
		.set({ inferred_standards: inferred, abi_fetched_at: new Date() })
		.where("contract_id", "=", contractId)
		.execute();
}

/**
 * A contract reorged out and not (yet) redeployed on the new fork is not on
 * the canonical chain — serve 404, not its stale row/ABI. Matches every other
 * contracts read (list, trait scope, pending-ABI), which already filter.
 */
export async function getContract(
	db: Kysely<Database>,
	contractId: string,
): Promise<Contract | null> {
	return (
		(await db
			.selectFrom("contracts")
			.selectAll()
			.where("contract_id", "=", contractId)
			.where("canonical", "=", true)
			.executeTakeFirst()) ?? null
	);
}

/**
 * Contracts awaiting an ABI fetch (drives the fetch/backfill worker): `pending`
 * first, then `failed` rows that are due for a retry. `limit` bounds both
 * together, so retries never out-poll the node faster than new deploys.
 */
export async function listContractsPendingAbi(
	db: Kysely<Database>,
	limit = 100,
	now: Date = new Date(),
): Promise<Contract[]> {
	return db
		.selectFrom("contracts")
		.selectAll()
		.where("canonical", "=", true)
		.where((eb) =>
			eb.or([
				eb("abi_status", "=", "pending"),
				eb.and([
					eb("abi_status", "=", "failed"),
					eb("abi_attempts", "<", ABI_MAX_ATTEMPTS),
					eb("abi_next_attempt_at", "<=", now),
				]),
			]),
		)
		.orderBy(sql`(abi_status = 'pending')`, "desc")
		.orderBy("block_height", "asc")
		.limit(limit)
		.execute();
}

export type Conformance = "declared" | "inferred" | "any";

/** Discovery: contracts matching a trait/standard, by conformance source. */
export async function listContractsByTrait(
	db: Kysely<Database>,
	trait: string,
	opts: {
		conformance?: Conformance;
		limit?: number;
		afterId?: string;
		/** Only contracts classified (ABI stored) at or after this time. */
		classifiedAfter?: Date;
	} = {},
): Promise<Contract[]> {
	const conformance = opts.conformance ?? "any";
	let q = db.selectFrom("contracts").selectAll().where("canonical", "=", true);

	if (conformance === "declared") {
		q = q.where(sql<boolean>`${sql.ref("declared_traits")} @> ARRAY[${trait}]`);
	} else if (conformance === "inferred") {
		q = q.where(
			sql<boolean>`${sql.ref("inferred_standards")} @> ARRAY[${trait}]`,
		);
	} else {
		q = q.where(
			sql<boolean>`(${sql.ref("declared_traits")} @> ARRAY[${trait}] OR ${sql.ref("inferred_standards")} @> ARRAY[${trait}])`,
		);
	}

	if (opts.afterId) q = q.where("contract_id", ">", opts.afterId);
	if (opts.classifiedAfter) {
		q = q.where("abi_fetched_at", ">=", opts.classifiedAfter);
	}
	return q
		.orderBy("contract_id", "asc")
		.limit(opts.limit ?? 100)
		.execute();
}

/**
 * The registry's "classified through" height: every canonical contract deploy
 * at or below it is registered and past `pending` (fetched, unparseable, or
 * `failed` after its retries, which the registry parks rather than blocks on).
 * The worker classifies on a timer, so a trait-scoped subgraph processing a
 * block above this height can miss a contract that conforms but is not yet
 * labelled; catch-up compares the block against this and waits.
 *
 * Only successful deploys count: an aborted deploy creates no contract, so
 * it can never conform to a trait and must not hold the height back.
 *
 * Returns the height just below the oldest unclassified deploy, or the
 * canonical tip when none is outstanding (`null` with an empty chain). Reads
 * the source plane, where `contracts` and `transactions` live.
 */
export async function registryClassifiedThrough(
	db: Kysely<Database>,
): Promise<number | null> {
	const { rows } = await sql<{ first_unclassified: string | number | null }>`
		SELECT LEAST(
			(SELECT MIN(t.block_height)
			   FROM transactions t
			  WHERE t.type = 'smart_contract'
			    AND t.status = 'success'
			    AND t.contract_id IS NOT NULL
			    AND NOT EXISTS (
			      SELECT 1 FROM contracts c
			       WHERE c.contract_id = t.contract_id AND c.canonical = true
			    )),
			(SELECT MIN(block_height) FROM contracts
			  WHERE canonical = true AND abi_status = 'pending')
		) AS first_unclassified
	`.execute(db);
	const first = rows[0]?.first_unclassified;
	if (first !== null && first !== undefined) return Number(first) - 1;
	return canonicalTip(db);
}

/** The registry classifies on a ~30 s loop, so a 15 s cache costs at most one
 *  extra classification interval of waiting. */
const REGISTRY_CLASSIFIED_TTL_MS = 15_000;

type RegistryReading = {
	/** Last successful value, `undefined` until the first query resolves. */
	value: { height: number | null; at: number } | undefined;
	/** The one query in flight (first read or background refresh). */
	inflight: Promise<number | null> | undefined;
};

/**
 * One reading per database for the whole process. The query scans every deploy
 * transaction (hundreds of ms on mainnet), too heavy to run per catch-up tick
 * or per Index tip refresh. A cached value can only be lower than a fresh one
 * (the classified height only rises), so reading it is safe: callers wait
 * slightly longer, never process a block the registry hasn't covered.
 */
const registryReadings = new WeakMap<Kysely<Database>, RegistryReading>();

/**
 * {@link registryClassifiedThrough} behind a 15 s single-flight cache with
 * stale-while-revalidate: concurrent callers share one query, and once a value
 * exists a stale read returns it immediately while one background refresh runs.
 * Only the first read in a process awaits the query. A failed first query is
 * not cached; a failed refresh keeps the previous value and retries on the
 * next read.
 */
export function cachedRegistryClassifiedThrough(
	db: Kysely<Database>,
	opts: {
		now?: () => number;
		read?: (db: Kysely<Database>) => Promise<number | null>;
	} = {},
): Promise<number | null> {
	const now = opts.now ?? Date.now;
	const read = opts.read ?? registryClassifiedThrough;
	let reading = registryReadings.get(db);
	if (!reading) {
		reading = { value: undefined, inflight: undefined };
		registryReadings.set(db, reading);
	}
	const entry = reading;
	const { value } = entry;
	if (value && now() - value.at < REGISTRY_CLASSIFIED_TTL_MS) {
		return Promise.resolve(value.height);
	}
	if (!entry.inflight) {
		const query = read(db).then((height) => {
			entry.value = { height, at: now() };
			return height;
		});
		const inflight = query.finally(() => {
			if (entry.inflight === inflight) entry.inflight = undefined;
		});
		entry.inflight = inflight;
		// A refresh nobody awaits must not surface as an unhandled rejection.
		inflight.catch(() => {});
	}
	return value ? Promise.resolve(value.height) : entry.inflight;
}

/** Drop the cached registry reading for `db`. For tests that change the
 *  registry between reads. */
export function forgetRegistryReading(db: Kysely<Database>): void {
	registryReadings.delete(db);
}

async function canonicalTip(db: Kysely<Database>): Promise<number | null> {
	const tip = await db
		.selectFrom("blocks")
		.select("height")
		.where("canonical", "=", true)
		.orderBy("height", "desc")
		.limit(1)
		.executeTakeFirst();
	return tip ? Number(tip.height) : null;
}

/**
 * How many blocks the registry trails the canonical tip (tip minus
 * {@link registryClassifiedThrough}). 0 when fully classified, `null` with an
 * empty chain. A trait-scoped subgraph waits this many blocks, so a growing
 * value is a stalled registry worker.
 */
export async function registryLagBlocks(
	db: Kysely<Database>,
): Promise<number | null> {
	const through = await registryClassifiedThrough(db);
	if (through === null) return null;
	const tip = await canonicalTip(db);
	return tip === null ? null : Math.max(0, tip - through);
}

/**
 * As-of-block trait resolution (B4): contract IDs conforming to `trait` whose
 * deploy block ≤ `asOfBlock`. Lets a trait-scoped subgraph reindex a token's
 * full history even if classification lagged its deploy.
 */
export async function resolveTraitContractIds(
	db: Kysely<Database>,
	trait: string,
	asOfBlock: number,
): Promise<string[]> {
	const rows = await db
		.selectFrom("contracts")
		.select("contract_id")
		.where("canonical", "=", true)
		.where("block_height", "<=", asOfBlock)
		.where(
			sql<boolean>`(${sql.ref("declared_traits")} @> ARRAY[${trait}] OR ${sql.ref("inferred_standards")} @> ARRAY[${trait}])`,
		)
		.execute();
	return rows.map((r) => r.contract_id);
}

/**
 * Reorg: flip contracts deployed at/above a reorged height to non-canonical.
 * Called from the indexer's handleReorg tx. Recovery is eventual: discovery
 * (discoverDeploys) re-selects non-canonical ids whose deploy tx exists on
 * the new fork and recordContractDeploy re-canonicalizes them.
 */
export async function markContractsNonCanonical(
	db: Kysely<Database>,
	fromBlockHeight: number,
): Promise<void> {
	await db
		.updateTable("contracts")
		.set({ canonical: false })
		.where("block_height", ">=", fromBlockHeight)
		.execute();
}
