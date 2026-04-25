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
