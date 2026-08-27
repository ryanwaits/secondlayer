import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";

/** Mapped columns from bns_name_events (real columns only). */
export type ExtendedBnsName = {
	name: string;
	namespace: string;
	fqn: string;
	owner: string | null;
	bns_id: string;
	topic: string;
	tx_id: string;
	block_height: number;
	registered_at: number | null;
	renewal_height: number | null;
};

export type BnsNameEventRow = {
	name: string;
	namespace: string;
	fqn: string;
	owner: string | null;
	bns_id: string;
	topic: string;
	tx_id: string;
	block_height: number | string;
	registered_at: number | string | null;
	renewal_height: number | string | null;
};

export function projectBnsName(row: BnsNameEventRow): ExtendedBnsName {
	return {
		name: row.name,
		namespace: row.namespace,
		fqn: row.fqn,
		owner: row.owner,
		bns_id: row.bns_id,
		topic: row.topic,
		tx_id: row.tx_id,
		block_height: Number(row.block_height),
		registered_at:
			row.registered_at === null || row.registered_at === undefined
				? null
				: Number(row.registered_at),
		renewal_height:
			row.renewal_height === null || row.renewal_height === undefined
				? null
				: Number(row.renewal_height),
	};
}

export type GetExtendedBnsName = (
	fqn: string,
) => Promise<ExtendedBnsName | null>;

/** Latest canonical bns_name_events row for fqn. burn-name → null (404). */
export async function getExtendedBnsName(
	fqn: string,
	db: Kysely<Database> = getSourceDb(),
): Promise<ExtendedBnsName | null> {
	const { rows } = await sql<BnsNameEventRow>`
		SELECT
			name,
			namespace,
			fqn,
			owner,
			bns_id,
			topic,
			tx_id,
			block_height,
			registered_at,
			renewal_height
		FROM bns_name_events
		WHERE fqn = ${fqn} AND canonical = true
		ORDER BY block_height DESC, event_index DESC
		LIMIT 1
	`.execute(db);

	const row = rows[0];
	if (!row) return null;
	if (row.topic === "burn-name") return null;
	return projectBnsName(row);
}

export type ListExtendedBnsNamesQuery = {
	address: string;
	limit: number;
	offset: number;
};

export type ListExtendedBnsNamesResult = {
	results: ExtendedBnsName[];
	total: number;
};

export type ListExtendedBnsNames = (
	q: ListExtendedBnsNamesQuery,
) => Promise<ListExtendedBnsNamesResult>;

/**
 * Distinct current names whose latest canonical event has owner = address
 * and topic is not burn-name.
 */
export async function listExtendedBnsNames(
	q: ListExtendedBnsNamesQuery,
	db: Kysely<Database> = getSourceDb(),
): Promise<ListExtendedBnsNamesResult> {
	const { rows: countRows } = await sql<{ count: string | number }>`
		SELECT COUNT(*)::bigint AS count
		FROM (
			SELECT DISTINCT ON (fqn) owner, topic
			FROM bns_name_events
			WHERE canonical = true
			ORDER BY fqn, block_height DESC, event_index DESC
		) latest
		WHERE owner = ${q.address} AND topic <> 'burn-name'
	`.execute(db);
	const total = Number(countRows[0]?.count ?? 0);

	const { rows } = await sql<BnsNameEventRow>`
		SELECT
			name,
			namespace,
			fqn,
			owner,
			bns_id,
			topic,
			tx_id,
			block_height,
			registered_at,
			renewal_height
		FROM (
			SELECT DISTINCT ON (fqn)
				name,
				namespace,
				fqn,
				owner,
				bns_id,
				topic,
				tx_id,
				block_height,
				registered_at,
				renewal_height
			FROM bns_name_events
			WHERE canonical = true
			ORDER BY fqn, block_height DESC, event_index DESC
		) latest
		WHERE owner = ${q.address} AND topic <> 'burn-name'
		ORDER BY fqn ASC
		LIMIT ${q.limit}
		OFFSET ${q.offset}
	`.execute(db);

	return {
		results: rows.map(projectBnsName),
		total,
	};
}
