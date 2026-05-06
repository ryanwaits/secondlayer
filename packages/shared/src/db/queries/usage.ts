import { type Kysely, sql } from "kysely";
import type { Database } from "../types.ts";

/** Increment API request counter for today. Fire-and-forget safe. */
export async function incrementApiRequests(
	db: Kysely<Database>,
	accountId: string,
): Promise<void> {
	const today = new Date().toISOString().slice(0, 10);
	await sql`
		INSERT INTO usage_daily (account_id, tenant_id, date, api_requests, deliveries)
		VALUES (${accountId}, NULL, ${today}, 1, 0)
		ON CONFLICT (account_id, date) WHERE tenant_id IS NULL
		DO UPDATE SET api_requests = usage_daily.api_requests + 1
	`.execute(db);
}

async function incrementAccountDailyCounter(
	db: Kysely<Database>,
	accountId: string,
	column: "streams_events_returned" | "index_decoded_events_returned",
	quantity: number,
): Promise<void> {
	if (quantity <= 0) return;
	const today = new Date().toISOString().slice(0, 10);
	await sql`
		INSERT INTO usage_daily (account_id, tenant_id, date, api_requests, deliveries, ${sql.raw(column)})
		VALUES (${accountId}, NULL, ${today}, 0, 0, ${quantity})
		ON CONFLICT (account_id, date) WHERE tenant_id IS NULL
		DO UPDATE SET ${sql.raw(column)} = usage_daily.${sql.raw(column)} + ${quantity}
	`.execute(db);
}

export async function incrementStreamsEventsReturned(
	db: Kysely<Database>,
	accountId: string,
	quantity: number,
): Promise<void> {
	await incrementAccountDailyCounter(
		db,
		accountId,
		"streams_events_returned",
		quantity,
	);
}

export async function incrementIndexDecodedEventsReturned(
	db: Kysely<Database>,
	accountId: string,
	quantity: number,
): Promise<void> {
	await incrementAccountDailyCounter(
		db,
		accountId,
		"index_decoded_events_returned",
		quantity,
	);
}

export interface UsageSummary {
	apiRequestsToday: number;
	deliveriesThisMonth: number;
	storageBytes: number;
}

/** Get current usage for an account. */
export async function getUsage(
	db: Kysely<Database>,
	accountId: string,
): Promise<UsageSummary> {
	const today = new Date().toISOString().slice(0, 10);
	const monthStart = `${today.slice(0, 7)}-01`; // YYYY-MM-01

	// Today's API requests
	const dailyRow = await db
		.selectFrom("usage_daily")
		.select("api_requests")
		.where("account_id", "=", accountId)
		.where("date", "=", today)
		.executeTakeFirst();

	// This month's deliveries
	const monthlyRow = await db
		.selectFrom("usage_daily")
		.select(sql<number>`COALESCE(SUM(deliveries), 0)`.as("total"))
		.where("account_id", "=", accountId)
		.where("date", ">=", monthStart)
		.executeTakeFirst();

	// Latest storage snapshot
	const storageRow = await db
		.selectFrom("usage_snapshots")
		.select("storage_bytes")
		.where("account_id", "=", accountId)
		.orderBy("measured_at", "desc")
		.limit(1)
		.executeTakeFirst();

	return {
		apiRequestsToday: dailyRow?.api_requests ?? 0,
		deliveriesThisMonth: Number(monthlyRow?.total ?? 0),
		storageBytes: Number(storageRow?.storage_bytes ?? 0),
	};
}

export interface ProductUsageBreakdown {
	streamsEventsToday: number;
	streamsEventsThisMonth: number;
	indexDecodedEventsToday: number;
	indexDecodedEventsThisMonth: number;
}

/** Get per-product event counts (today + this month) for an account. */
export async function getProductUsage(
	db: Kysely<Database>,
	accountId: string,
): Promise<ProductUsageBreakdown> {
	const today = new Date().toISOString().slice(0, 10);
	const monthStart = `${today.slice(0, 7)}-01`;

	const dailyRow = await db
		.selectFrom("usage_daily")
		.select(["streams_events_returned", "index_decoded_events_returned"])
		.where("account_id", "=", accountId)
		.where("date", "=", today)
		.executeTakeFirst();

	const monthlyRow = await db
		.selectFrom("usage_daily")
		.select([
			sql<number>`COALESCE(SUM(streams_events_returned), 0)`.as(
				"streams_total",
			),
			sql<number>`COALESCE(SUM(index_decoded_events_returned), 0)`.as(
				"index_total",
			),
		])
		.where("account_id", "=", accountId)
		.where("date", ">=", monthStart)
		.executeTakeFirst();

	return {
		streamsEventsToday: Number(dailyRow?.streams_events_returned ?? 0),
		streamsEventsThisMonth: Number(monthlyRow?.streams_total ?? 0),
		indexDecodedEventsToday: Number(
			dailyRow?.index_decoded_events_returned ?? 0,
		),
		indexDecodedEventsThisMonth: Number(monthlyRow?.index_total ?? 0),
	};
}

/**
 * Measure storage for all accounts by querying pg_total_relation_size
 * for each tenant's subgraph schemas.
 */
export async function measureStorage(db: Kysely<Database>): Promise<void> {
	// Get all accounts with subgraphs
	const accountSubgraphs = await db
		.selectFrom("subgraphs")
		.select(["account_id", "schema_name"])
		.where("schema_name", "is not", null)
		.execute();

	// Group schemas by account
	const byAccount = new Map<string, string[]>();
	for (const row of accountSubgraphs) {
		const schemas = byAccount.get(row.account_id) ?? [];
		if (row.schema_name) schemas.push(row.schema_name);
		byAccount.set(row.account_id, schemas);
	}

	for (const [accountId, schemas] of byAccount) {
		let totalBytes = 0;
		for (const schema of schemas) {
			try {
				const result = await sql<{ size: string }>`
          SELECT COALESCE(SUM(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename))), 0)::text as size
          FROM pg_tables WHERE schemaname = ${schema}
        `.execute(db);
				const row = result.rows[0] as { size?: string } | undefined;
				totalBytes += Number(row?.size ?? 0);
			} catch {
				// Schema may not exist
			}
		}

		await db
			.insertInto("usage_snapshots")
			.values({
				account_id: accountId,
				storage_bytes: totalBytes,
			})
			.execute();
	}
}
