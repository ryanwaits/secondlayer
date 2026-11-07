import { type Kysely, sql } from "kysely";
import { jsonb } from "../jsonb.ts";
import { casTransition, defineMachine } from "../transition.ts";
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
export const ABI_MACHINE = defineMachine({
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
