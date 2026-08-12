import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";

/**
 * Cheap, SQL-computed digests over a height range — the basis of a verify that
 * runs in seconds instead of hours.
 *
 * The archive's per-object `sha256:parquet-object` digests can only be checked
 * by regenerating the Parquet locally, which costs a full export. That is a
 * reasonable paranoid check and a terrible first-run experience: nobody will
 * spend two hours to discover whether they are broken. These digests are
 * computed by the database itself, over the columns that actually carry chain
 * identity, so an operator gets an answer before they lose interest.
 *
 * What this catches is not a subset chosen for convenience — it is precisely
 * the defect class seen in production: missing heights, a canonical child whose
 * `parent_hash` names a block we no longer hold, duplicate canonical rows at one
 * height, and any altered block/transaction identity. What it deliberately does
 * NOT catch is a difference in bulky payload columns (`raw_tx`, event `data`)
 * that leaves identity intact; `--deep` re-export exists for that.
 *
 * Determinism rules, so two independent databases agree:
 *  - Aggregate over an explicit ORDER BY, never table order.
 *  - Hash each row to a fixed-width digest FIRST, then aggregate those, so the
 *    intermediate string is 32 bytes/row rather than the whole row.
 *  - Normalize NULL to a sentinel that cannot collide with a real value.
 *  - Never include a column whose representation is environment-dependent
 *    (timestamps with timezone rendering, generated ids, `created_at`).
 */

export const RANGE_DIGEST_SPEC = "md5:sql-identity-v1" as const;

export type RangeDigestDataset = "blocks" | "transactions" | "events";

export type RangeDigest = {
	dataset: RangeDigestDataset;
	from_block: number;
	to_block: number;
	row_count: number;
	/** null when the range holds no rows — an empty range has no digest, and
	 *  that is materially different from "a digest that happens to be of zero
	 *  rows", which would compare equal across datasets. */
	digest: string | null;
	digest_spec: typeof RANGE_DIGEST_SPEC;
};

/**
 * Identity columns per dataset. `blocks` carries the whole corruption surface
 * we care about, which is why quick mode leans on it.
 */
function identityExpression(dataset: RangeDigestDataset) {
	if (dataset === "blocks") {
		return sql`md5(
			height::text || '|' ||
			hash || '|' ||
			parent_hash || '|' ||
			burn_block_height::text || '|' ||
			coalesce(burn_block_hash, '~') || '|' ||
			coalesce(index_block_hash, '~')
		)`;
	}
	if (dataset === "transactions") {
		return sql`md5(
			tx_id || '|' ||
			block_height::text || '|' ||
			tx_index::text || '|' ||
			type || '|' ||
			sender || '|' ||
			status || '|' ||
			coalesce(contract_id, '~') || '|' ||
			coalesce(function_name, '~')
		)`;
	}
	return sql`md5(
		tx_id || '|' ||
		block_height::text || '|' ||
		event_index::text || '|' ||
		type
	)`;
}

function orderExpression(dataset: RangeDigestDataset) {
	if (dataset === "blocks") return sql`height`;
	if (dataset === "transactions") return sql`block_height, tx_index, tx_id`;
	return sql`block_height, event_index, tx_id`;
}

/**
 * Rows are restricted to CANONICAL blocks in every dataset — a non-canonical
 * row at a height must not change the digest, or a database that merely retains
 * more reorg history than another would report as diverging.
 */
function fromExpression(dataset: RangeDigestDataset) {
	if (dataset === "blocks") {
		return sql`FROM blocks WHERE canonical = true`;
	}
	const table = dataset === "transactions" ? sql`transactions` : sql`events`;
	return sql`FROM ${table} AS child
		JOIN blocks AS b ON b.height = child.block_height AND b.canonical = true
		WHERE true`;
}

function heightColumn(dataset: RangeDigestDataset) {
	return dataset === "blocks" ? sql`height` : sql`child.block_height`;
}

export async function computeRangeDigest(
	db: Kysely<Database>,
	dataset: RangeDigestDataset,
	fromBlock: number,
	toBlock: number,
): Promise<RangeDigest> {
	const { rows } = await sql<{ digest: string | null; row_count: string }>`
		SELECT
			md5(string_agg(row_digest, '' ORDER BY ord)) AS digest,
			COUNT(*)::text AS row_count
		FROM (
			SELECT
				${identityExpression(dataset)} AS row_digest,
				row_number() OVER (ORDER BY ${orderExpression(dataset)}) AS ord
			${fromExpression(dataset)}
				AND ${heightColumn(dataset)} >= ${fromBlock}
				AND ${heightColumn(dataset)} <= ${toBlock}
		) AS identity_rows
	`.execute(db);

	const row = rows[0];
	const rowCount = Number(row?.row_count ?? 0);
	return {
		dataset,
		from_block: fromBlock,
		to_block: toBlock,
		row_count: rowCount,
		digest: rowCount === 0 ? null : (row?.digest ?? null),
		digest_spec: RANGE_DIGEST_SPEC,
	};
}

export async function computeRangeDigests(
	db: Kysely<Database>,
	fromBlock: number,
	toBlock: number,
	datasets: readonly RangeDigestDataset[] = [
		"blocks",
		"transactions",
		"events",
	],
): Promise<RangeDigest[]> {
	const digests: RangeDigest[] = [];
	for (const dataset of datasets) {
		digests.push(await computeRangeDigest(db, dataset, fromBlock, toBlock));
	}
	return digests;
}

export type RangeComparison = {
	dataset: RangeDigestDataset;
	from_block: number;
	to_block: number;
	status: "match" | "digest-mismatch" | "count-mismatch" | "missing-locally";
	expected_digest: string | null;
	actual_digest: string | null;
	expected_rows: number;
	actual_rows: number;
};

/**
 * Compare locally computed digests against a reference set.
 *
 * Row count is reported separately from digest because the two failures mean
 * different things to an operator: a count difference is missing or extra data
 * (usually a gap or an un-swept reorg), while an equal count with a different
 * digest means the same number of rows carry different identities — the
 * fork-point corruption signature.
 */
export function compareRangeDigests(
	local: readonly RangeDigest[],
	reference: readonly RangeDigest[],
): RangeComparison[] {
	const localByKey = new Map(
		local.map((d) => [`${d.dataset}:${d.from_block}-${d.to_block}`, d]),
	);

	return reference.map((expected) => {
		const key = `${expected.dataset}:${expected.from_block}-${expected.to_block}`;
		const actual = localByKey.get(key);
		const base = {
			dataset: expected.dataset,
			from_block: expected.from_block,
			to_block: expected.to_block,
			expected_digest: expected.digest,
			expected_rows: expected.row_count,
		};
		if (!actual) {
			return {
				...base,
				status: "missing-locally" as const,
				actual_digest: null,
				actual_rows: 0,
			};
		}
		const status =
			actual.row_count !== expected.row_count
				? ("count-mismatch" as const)
				: actual.digest === expected.digest
					? ("match" as const)
					: ("digest-mismatch" as const);
		return {
			...base,
			status,
			actual_digest: actual.digest,
			actual_rows: actual.row_count,
		};
	});
}
