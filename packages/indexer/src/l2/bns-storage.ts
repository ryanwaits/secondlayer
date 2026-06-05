import { getSourceDb } from "@secondlayer/shared/db";
import type {
	BnsMarketplaceAction,
	BnsNameEventTopic,
	BnsNamespaceEventStatus,
} from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";

export const BNS_DECODER_NAME = "l2.bns.v1";

// ── Event row types ─────────────────────────────────────────────────────────

export type BnsNameEventRow = {
	cursor: string;
	block_height: number;
	block_time: Date;
	tx_id: string;
	tx_index: number;
	event_index: number;
	topic: BnsNameEventTopic;
	namespace: string;
	name: string;
	fqn: string;
	owner: string | null;
	bns_id: string;
	registered_at: number | null;
	imported_at: number | null;
	renewal_height: number | null;
	stx_burn: string | null;
	preordered_by: string | null;
	hashed_salted_fqn_preorder: string | null;
	source_cursor: string;
};

export type BnsNamespaceEventRow = {
	cursor: string;
	block_height: number;
	block_time: Date;
	tx_id: string;
	tx_index: number;
	event_index: number;
	status: BnsNamespaceEventStatus;
	namespace: string;
	manager: string | null;
	manager_frozen: boolean | null;
	manager_transfers_disabled: boolean | null;
	price_function: string | null;
	price_frozen: boolean | null;
	lifetime: number | null;
	revealed_at: number | null;
	launched_at: number | null;
	source_cursor: string;
};

export type BnsMarketplaceEventRow = {
	cursor: string;
	block_height: number;
	block_time: Date;
	tx_id: string;
	tx_index: number;
	event_index: number;
	action: BnsMarketplaceAction;
	bns_id: string;
	price_ustx: string | null;
	commission: string | null;
	source_cursor: string;
};

// ── Projection upsert types ─────────────────────────────────────────────────

export type BnsNameUpsert = {
	fqn: string;
	namespace: string;
	name: string;
	owner: string;
	bns_id: string;
	registered_at: number | null;
	renewal_height: number | null;
	last_event_cursor: string;
	last_event_at: Date;
};

export type BnsNamespaceUpsert = {
	namespace: string;
	manager: string | null;
	manager_frozen: boolean;
	price_frozen: boolean;
	lifetime: number | null;
	launched_at: number | null;
	last_event_cursor: string;
	last_event_at: Date;
};

function db(client?: Kysely<Database>): Kysely<Database> {
	return client ?? getSourceDb();
}

// ── Event writers ───────────────────────────────────────────────────────────

export async function writeBnsNameEvents(
	rows: BnsNameEventRow[],
	opts?: { db?: Kysely<Database> },
): Promise<void> {
	if (rows.length === 0) return;
	await db(opts?.db)
		.insertInto("bns_name_events")
		.values(rows)
		.onConflict((oc) =>
			oc.column("cursor").doUpdateSet((eb) => ({
				block_height: eb.ref("excluded.block_height"),
				block_time: eb.ref("excluded.block_time"),
				tx_id: eb.ref("excluded.tx_id"),
				tx_index: eb.ref("excluded.tx_index"),
				event_index: eb.ref("excluded.event_index"),
				topic: eb.ref("excluded.topic"),
				namespace: eb.ref("excluded.namespace"),
				name: eb.ref("excluded.name"),
				fqn: eb.ref("excluded.fqn"),
				owner: eb.ref("excluded.owner"),
				bns_id: eb.ref("excluded.bns_id"),
				registered_at: eb.ref("excluded.registered_at"),
				imported_at: eb.ref("excluded.imported_at"),
				renewal_height: eb.ref("excluded.renewal_height"),
				stx_burn: eb.ref("excluded.stx_burn"),
				preordered_by: eb.ref("excluded.preordered_by"),
				hashed_salted_fqn_preorder: eb.ref(
					"excluded.hashed_salted_fqn_preorder",
				),
				canonical: true,
				source_cursor: eb.ref("excluded.source_cursor"),
			})),
		)
		.execute();
}

export async function writeBnsNamespaceEvents(
	rows: BnsNamespaceEventRow[],
	opts?: { db?: Kysely<Database> },
): Promise<void> {
	if (rows.length === 0) return;
	await db(opts?.db)
		.insertInto("bns_namespace_events")
		.values(rows)
		.onConflict((oc) =>
			oc.column("cursor").doUpdateSet((eb) => ({
				block_height: eb.ref("excluded.block_height"),
				block_time: eb.ref("excluded.block_time"),
				tx_id: eb.ref("excluded.tx_id"),
				tx_index: eb.ref("excluded.tx_index"),
				event_index: eb.ref("excluded.event_index"),
				status: eb.ref("excluded.status"),
				namespace: eb.ref("excluded.namespace"),
				manager: eb.ref("excluded.manager"),
				manager_frozen: eb.ref("excluded.manager_frozen"),
				manager_transfers_disabled: eb.ref(
					"excluded.manager_transfers_disabled",
				),
				price_function: eb.ref("excluded.price_function"),
				price_frozen: eb.ref("excluded.price_frozen"),
				lifetime: eb.ref("excluded.lifetime"),
				revealed_at: eb.ref("excluded.revealed_at"),
				launched_at: eb.ref("excluded.launched_at"),
				canonical: true,
				source_cursor: eb.ref("excluded.source_cursor"),
			})),
		)
		.execute();
}

export async function writeBnsMarketplaceEvents(
	rows: BnsMarketplaceEventRow[],
	opts?: { db?: Kysely<Database> },
): Promise<void> {
	if (rows.length === 0) return;
	await db(opts?.db)
		.insertInto("bns_marketplace_events")
		.values(rows)
		.onConflict((oc) =>
			oc.column("cursor").doUpdateSet((eb) => ({
				block_height: eb.ref("excluded.block_height"),
				block_time: eb.ref("excluded.block_time"),
				tx_id: eb.ref("excluded.tx_id"),
				tx_index: eb.ref("excluded.tx_index"),
				event_index: eb.ref("excluded.event_index"),
				action: eb.ref("excluded.action"),
				bns_id: eb.ref("excluded.bns_id"),
				price_ustx: eb.ref("excluded.price_ustx"),
				commission: eb.ref("excluded.commission"),
				canonical: true,
				source_cursor: eb.ref("excluded.source_cursor"),
			})),
		)
		.execute();
}

// ── Projection upserts ──────────────────────────────────────────────────────

export async function upsertBnsName(
	row: BnsNameUpsert,
	opts?: { db?: Kysely<Database> },
): Promise<void> {
	await db(opts?.db)
		.insertInto("bns_names")
		.values(row)
		.onConflict((oc) =>
			oc.column("fqn").doUpdateSet((eb) => ({
				namespace: eb.ref("excluded.namespace"),
				name: eb.ref("excluded.name"),
				owner: eb.ref("excluded.owner"),
				bns_id: eb.ref("excluded.bns_id"),
				registered_at: eb.ref("excluded.registered_at"),
				renewal_height: eb.ref("excluded.renewal_height"),
				last_event_cursor: eb.ref("excluded.last_event_cursor"),
				last_event_at: eb.ref("excluded.last_event_at"),
				updated_at: new Date(),
			})),
		)
		.execute();
}

/** burn-name handler: removes the FQN from the projection. */
export async function deleteBnsName(
	fqn: string,
	opts?: { db?: Kysely<Database> },
): Promise<void> {
	await db(opts?.db).deleteFrom("bns_names").where("fqn", "=", fqn).execute();
}

export async function upsertBnsNamespace(
	row: BnsNamespaceUpsert,
	opts?: { db?: Kysely<Database> },
): Promise<void> {
	await db(opts?.db)
		.insertInto("bns_namespaces")
		.values(row)
		.onConflict((oc) =>
			oc.column("namespace").doUpdateSet((eb) => ({
				manager: eb.ref("excluded.manager"),
				manager_frozen: eb.ref("excluded.manager_frozen"),
				price_frozen: eb.ref("excluded.price_frozen"),
				lifetime: eb.ref("excluded.lifetime"),
				launched_at: eb.ref("excluded.launched_at"),
				last_event_cursor: eb.ref("excluded.last_event_cursor"),
				last_event_at: eb.ref("excluded.last_event_at"),
				updated_at: new Date(),
			})),
		)
		.execute();
}

// ── Reorg handling ──────────────────────────────────────────────────────────

/**
 * Mark BNS event rows non-canonical when a reorg invalidates a height range.
 *
 * NOTE: projections (bns_names, bns_namespaces) are NOT rolled back here —
 * doing so requires replaying the surviving canonical events from before the
 * reorg, which is expensive. The decoder will re-converge the projection on
 * the next forward pass through the new canonical events. Acceptable because
 * BNS reads from the projection via API are eventually-consistent.
 */
export async function handleBnsReorg(
	blockHeight: number,
	opts?: { db?: Kysely<Database> },
): Promise<{ markedNonCanonical: number; checkpoint: string | null }> {
	const client = db(opts?.db);

	const nameResult = await client
		.updateTable("bns_name_events")
		.set({ canonical: false })
		.where("block_height", ">=", blockHeight)
		.where("canonical", "=", true)
		.executeTakeFirst();

	const namespaceResult = await client
		.updateTable("bns_namespace_events")
		.set({ canonical: false })
		.where("block_height", ">=", blockHeight)
		.where("canonical", "=", true)
		.executeTakeFirst();

	const marketplaceResult = await client
		.updateTable("bns_marketplace_events")
		.set({ canonical: false })
		.where("block_height", ">=", blockHeight)
		.where("canonical", "=", true)
		.executeTakeFirst();

	const checkpointRow = await client
		.selectFrom("bns_name_events")
		.select("source_cursor")
		.where("block_height", "<", blockHeight)
		.where("canonical", "=", true)
		.orderBy("block_height", "desc")
		.orderBy("event_index", "desc")
		.limit(1)
		.executeTakeFirst();

	return {
		markedNonCanonical:
			Number(nameResult.numUpdatedRows ?? 0) +
			Number(namespaceResult.numUpdatedRows ?? 0) +
			Number(marketplaceResult.numUpdatedRows ?? 0),
		checkpoint: checkpointRow?.source_cursor ?? null,
	};
}
