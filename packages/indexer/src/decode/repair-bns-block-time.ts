/**
 * One-shot: rewrite BNS `block_time` / `last_event_at` from `blocks.timestamp`.
 *
 * The BNS decoder used to stamp wall-clock at decode time (it read a
 * non-existent Streams `block_time` field). Identity/state is fine; clocks
 * are not. Streams `ts` is `to_timestamp(blocks.timestamp)`, so this is the
 * same source the live decoder now writes via `new Date(event.ts)`.
 *
 * Skips rows whose canonical block has `timestamp = 0` (known bulk-import
 * hole, heights ~7.80–7.84M). A re-decode would stamp those 1970. Leave
 * them until the blocks plane is repaired, then re-run this script.
 *
 * Does not touch decoder checkpoints. Live BNS stays at tip.
 *
 * Dry-run by default. Run against the SOURCE/chain plane.
 *
 *   bun run packages/indexer/src/decode/repair-bns-block-time.ts
 *   bun run packages/indexer/src/decode/repair-bns-block-time.ts --apply
 *
 * Prod: ssh app-server, then `docker exec` the RUNNING decoder. Never
 * `docker compose run` (depends_on postgres recreates the volume).
 *
 *   ssh app-server
 *   docker exec secondlayer-decoder-1 bun run packages/indexer/src/decode/repair-bns-block-time.ts
 *   docker exec secondlayer-decoder-1 bun run packages/indexer/src/decode/repair-bns-block-time.ts --apply
 */
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

export type TableCounts = {
	wouldUpdate: number;
	husks: number;
	alreadyOk: number;
	unmatched: number;
};

export type ProjectionCounts = {
	wouldUpdate: number;
	missingEvent: number;
	huskCursor: number;
};

export type BnsBlockTimeRepairReport = {
	nameEvents: TableCounts;
	namespaceEvents: TableCounts;
	marketplaceEvents: TableCounts;
	names: ProjectionCounts;
	namespaces: ProjectionCounts;
};

export type BnsBlockTimeRepairApplied = {
	nameEvents: number;
	namespaceEvents: number;
	marketplaceEvents: number;
	names: number;
	namespaces: number;
};

type Args = { apply: boolean };

export function parseArgs(argv: string[]): Args {
	let apply = false;
	for (const arg of argv) {
		if (arg === "--apply") apply = true;
		else throw new Error(`unknown arg: ${arg}`);
	}
	return { apply };
}

function n(value: string | number | bigint | null | undefined): number {
	return Number(value ?? 0);
}

async function eventCounts(
	db: Kysely<Database>,
	table: "bns_name_events" | "bns_namespace_events" | "bns_marketplace_events",
): Promise<TableCounts> {
	const from =
		table === "bns_name_events"
			? sql`bns_name_events`
			: table === "bns_namespace_events"
				? sql`bns_namespace_events`
				: sql`bns_marketplace_events`;
	const { rows } = await sql<{
		would_update: string;
		husks: string;
		already_ok: string;
		unmatched: string;
	}>`
		SELECT
			count(*) FILTER (
				WHERE b.timestamp > 0
					AND e.block_time IS DISTINCT FROM to_timestamp(b.timestamp)
			)::text AS would_update,
			count(*) FILTER (WHERE b.height IS NOT NULL AND COALESCE(b.timestamp, 0) = 0)::text AS husks,
			count(*) FILTER (
				WHERE b.timestamp > 0
					AND e.block_time IS NOT DISTINCT FROM to_timestamp(b.timestamp)
			)::text AS already_ok,
			count(*) FILTER (WHERE b.height IS NULL)::text AS unmatched
		FROM ${from} e
		LEFT JOIN blocks b ON b.height = e.block_height AND b.canonical = true
	`.execute(db);
	const row = rows[0];
	return {
		wouldUpdate: n(row?.would_update),
		husks: n(row?.husks),
		alreadyOk: n(row?.already_ok),
		unmatched: n(row?.unmatched),
	};
}

async function projectionCounts(
	db: Kysely<Database>,
	kind: "names" | "namespaces",
): Promise<ProjectionCounts> {
	const query =
		kind === "names"
			? sql<{
					would_update: string;
					missing_event: string;
					husk_cursor: string;
				}>`
				SELECT
					count(*) FILTER (
						WHERE e.cursor IS NOT NULL
							AND b.timestamp > 0
							AND n.last_event_at IS DISTINCT FROM to_timestamp(b.timestamp)
					)::text AS would_update,
					count(*) FILTER (WHERE e.cursor IS NULL)::text AS missing_event,
					count(*) FILTER (
						WHERE e.cursor IS NOT NULL AND COALESCE(b.timestamp, 0) = 0
					)::text AS husk_cursor
				FROM bns_names n
				LEFT JOIN bns_name_events e ON e.cursor = n.last_event_cursor
				LEFT JOIN blocks b ON b.height = e.block_height AND b.canonical = true
			`
			: sql<{
					would_update: string;
					missing_event: string;
					husk_cursor: string;
				}>`
				SELECT
					count(*) FILTER (
						WHERE e.cursor IS NOT NULL
							AND b.timestamp > 0
							AND n.last_event_at IS DISTINCT FROM to_timestamp(b.timestamp)
					)::text AS would_update,
					count(*) FILTER (WHERE e.cursor IS NULL)::text AS missing_event,
					count(*) FILTER (
						WHERE e.cursor IS NOT NULL AND COALESCE(b.timestamp, 0) = 0
					)::text AS husk_cursor
				FROM bns_namespaces n
				LEFT JOIN bns_namespace_events e ON e.cursor = n.last_event_cursor
				LEFT JOIN blocks b ON b.height = e.block_height AND b.canonical = true
			`;
	const { rows } = await query.execute(db);
	const row = rows[0];
	return {
		wouldUpdate: n(row?.would_update),
		missingEvent: n(row?.missing_event),
		huskCursor: n(row?.husk_cursor),
	};
}

export async function reportBnsBlockTimeRepair(
	db: Kysely<Database>,
): Promise<BnsBlockTimeRepairReport> {
	return {
		nameEvents: await eventCounts(db, "bns_name_events"),
		namespaceEvents: await eventCounts(db, "bns_namespace_events"),
		marketplaceEvents: await eventCounts(db, "bns_marketplace_events"),
		names: await projectionCounts(db, "names"),
		namespaces: await projectionCounts(db, "namespaces"),
	};
}

export async function applyBnsBlockTimeRepair(
	db: Kysely<Database>,
): Promise<BnsBlockTimeRepairApplied> {
	return await db.transaction().execute(async (tx) => {
		await sql`SET LOCAL lock_timeout = '30s'`.execute(tx);
		const nameEvents = await sql`
			UPDATE bns_name_events e
			SET block_time = to_timestamp(b.timestamp)
			FROM blocks b
			WHERE b.height = e.block_height
				AND b.canonical = true
				AND b.timestamp > 0
				AND e.block_time IS DISTINCT FROM to_timestamp(b.timestamp)
		`.execute(tx);
		const namespaceEvents = await sql`
			UPDATE bns_namespace_events e
			SET block_time = to_timestamp(b.timestamp)
			FROM blocks b
			WHERE b.height = e.block_height
				AND b.canonical = true
				AND b.timestamp > 0
				AND e.block_time IS DISTINCT FROM to_timestamp(b.timestamp)
		`.execute(tx);
		const marketplaceEvents = await sql`
			UPDATE bns_marketplace_events e
			SET block_time = to_timestamp(b.timestamp)
			FROM blocks b
			WHERE b.height = e.block_height
				AND b.canonical = true
				AND b.timestamp > 0
				AND e.block_time IS DISTINCT FROM to_timestamp(b.timestamp)
		`.execute(tx);
		const names = await sql`
			UPDATE bns_names n
			SET last_event_at = to_timestamp(b.timestamp),
				updated_at = now()
			FROM bns_name_events e
			JOIN blocks b ON b.height = e.block_height AND b.canonical = true
			WHERE e.cursor = n.last_event_cursor
				AND b.timestamp > 0
				AND n.last_event_at IS DISTINCT FROM to_timestamp(b.timestamp)
		`.execute(tx);
		const namespaces = await sql`
			UPDATE bns_namespaces n
			SET last_event_at = to_timestamp(b.timestamp),
				updated_at = now()
			FROM bns_namespace_events e
			JOIN blocks b ON b.height = e.block_height AND b.canonical = true
			WHERE e.cursor = n.last_event_cursor
				AND b.timestamp > 0
				AND n.last_event_at IS DISTINCT FROM to_timestamp(b.timestamp)
		`.execute(tx);
		return {
			nameEvents: n(nameEvents.numAffectedRows),
			namespaceEvents: n(namespaceEvents.numAffectedRows),
			marketplaceEvents: n(marketplaceEvents.numAffectedRows),
			names: n(names.numAffectedRows),
			namespaces: n(namespaces.numAffectedRows),
		};
	});
}

function logTable(label: string, c: TableCounts): void {
	console.log(
		`  ${label}: would_update=${c.wouldUpdate} husks=${c.husks} already_ok=${c.alreadyOk} unmatched=${c.unmatched}`,
	);
}

function logProjection(label: string, c: ProjectionCounts): void {
	console.log(
		`  ${label}: would_update=${c.wouldUpdate} missing_event=${c.missingEvent} husk_cursor=${c.huskCursor}`,
	);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const db = getSourceDb();
	console.log(
		`[repair-bns-block-time] ${args.apply ? "APPLY" : "dry-run"} · source=blocks.timestamp · skip timestamp=0`,
	);

	const report = await reportBnsBlockTimeRepair(db);
	logTable("bns_name_events", report.nameEvents);
	logTable("bns_namespace_events", report.namespaceEvents);
	logTable("bns_marketplace_events", report.marketplaceEvents);
	logProjection("bns_names", report.names);
	logProjection("bns_namespaces", report.namespaces);

	const unmatched =
		report.nameEvents.unmatched +
		report.namespaceEvents.unmatched +
		report.marketplaceEvents.unmatched;
	if (unmatched > 0) {
		console.log(
			`[repair-bns-block-time] unmatched events (no canonical block): ${unmatched} — inspect before --apply`,
		);
	}

	if (!args.apply) {
		console.log(
			"[repair-bns-block-time] dry-run only — re-run with --apply to write.",
		);
		await closeDb();
		return;
	}

	const applied = await applyBnsBlockTimeRepair(db);
	console.log(
		`[repair-bns-block-time] updated name_events=${applied.nameEvents} namespace_events=${applied.namespaceEvents} marketplace_events=${applied.marketplaceEvents} names=${applied.names} namespaces=${applied.namespaces}`,
	);

	const after = await reportBnsBlockTimeRepair(db);
	logTable("bns_name_events (after)", after.nameEvents);
	logTable("bns_namespace_events (after)", after.namespaceEvents);
	logTable("bns_marketplace_events (after)", after.marketplaceEvents);
	logProjection("bns_names (after)", after.names);
	logProjection("bns_namespaces (after)", after.namespaces);
	console.log(
		"[repair-bns-block-time] expect would_update=0 on timestamp>0 rows; husks stay until blocks.timestamp is repaired.",
	);

	await closeDb();
}

if (import.meta.main) {
	void main();
}
