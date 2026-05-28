import { type Kysely, sql } from "kysely";
import { jsonb } from "../jsonb.ts";
import type { Contract, Database } from "../types.ts";

/**
 * Contract registry queries — backing for trait-based discovery. Populated from
 * contract deploys; ABI fetched async; standards inferred by static analysis.
 */

export type AbiStatus = "pending" | "fetched" | "failed" | "unparseable";

/** Record a contract deploy (idempotent). ABI is fetched separately + async. */
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
		.onConflict((oc) => oc.column("contract_id").doNothing())
		.execute();
}

/** Store a fetched ABI + the traits/standards derived from it. */
export async function setContractAbi(
	db: Kysely<Database>,
	contractId: string,
	data: {
		abi: unknown | null;
		status: AbiStatus;
		declaredTraits?: string[];
		inferredStandards?: string[];
	},
): Promise<void> {
	await db
		.updateTable("contracts")
		.set({
			abi: data.abi == null ? null : jsonb(data.abi),
			abi_status: data.status,
			abi_fetched_at: new Date(),
			...(data.declaredTraits ? { declared_traits: data.declaredTraits } : {}),
			...(data.inferredStandards
				? { inferred_standards: data.inferredStandards }
				: {}),
		})
		.where("contract_id", "=", contractId)
		.execute();
}

export async function getContract(
	db: Kysely<Database>,
	contractId: string,
): Promise<Contract | null> {
	return (
		(await db
			.selectFrom("contracts")
			.selectAll()
			.where("contract_id", "=", contractId)
			.executeTakeFirst()) ?? null
	);
}

/** Contracts still awaiting an ABI fetch (drives the fetch/backfill worker). */
export async function listContractsPendingAbi(
	db: Kysely<Database>,
	limit = 100,
): Promise<Contract[]> {
	return db
		.selectFrom("contracts")
		.selectAll()
		.where("abi_status", "=", "pending")
		.where("canonical", "=", true)
		.orderBy("block_height", "asc")
		.limit(limit)
		.execute();
}

export type Conformance = "declared" | "inferred" | "any";

/** Discovery: contracts matching a trait/standard, by conformance source. */
export async function listContractsByTrait(
	db: Kysely<Database>,
	trait: string,
	opts: { conformance?: Conformance; limit?: number; afterId?: string } = {},
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

/** Reorg: flip contracts deployed at/above a reorged height to non-canonical. */
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
