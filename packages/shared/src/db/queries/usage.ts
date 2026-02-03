import { sql, type Kysely } from "kysely";
import type { Database } from "../types.ts";
import { getPlanLimits } from "../../lib/plans.ts";

/** Increment API request counter for today. Fire-and-forget safe. */
export async function incrementApiRequests(
  db: Kysely<Database>,
  accountId: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await db
    .insertInto("usage_daily")
    .values({ account_id: accountId, date: today, api_requests: 1, deliveries: 0 })
    .onConflict((oc) =>
      oc.columns(["account_id", "date"]).doUpdateSet({
        api_requests: sql`usage_daily.api_requests + 1`,
      }),
    )
    .execute();
}

/** Increment delivery counter for today. */
export async function incrementDeliveries(
  db: Kysely<Database>,
  accountId: string,
  count = 1,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await db
    .insertInto("usage_daily")
    .values({ account_id: accountId, date: today, api_requests: 0, deliveries: count })
    .onConflict((oc) =>
      oc.columns(["account_id", "date"]).doUpdateSet({
        deliveries: sql`usage_daily.deliveries + ${count}`,
      }),
    )
    .execute();
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
  const monthStart = today.slice(0, 7) + "-01"; // YYYY-MM-01

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

export interface LimitCheck {
  allowed: boolean;
  limits: ReturnType<typeof getPlanLimits>;
  current: UsageSummary & { streams: number; views: number };
  exceeded?: string;
}

/** Check if an account is within plan limits. */
export async function checkLimits(
  db: Kysely<Database>,
  accountId: string,
  plan: string,
): Promise<LimitCheck> {
  const limits = getPlanLimits(plan);
  const usage = await getUsage(db, accountId);

  // Count streams owned by this account's keys
  const streamCount = await db
    .selectFrom("streams")
    .innerJoin("api_keys", "streams.api_key_id", "api_keys.id")
    .select(sql<number>`count(*)`.as("count"))
    .where("api_keys.account_id", "=", accountId)
    .executeTakeFirst();

  const viewCount = await db
    .selectFrom("views")
    .innerJoin("api_keys", "views.api_key_id", "api_keys.id")
    .select(sql<number>`count(*)`.as("count"))
    .where("api_keys.account_id", "=", accountId)
    .executeTakeFirst();

  const current = {
    ...usage,
    streams: Number(streamCount?.count ?? 0),
    views: Number(viewCount?.count ?? 0),
  };

  // Check each limit
  if (current.streams >= limits.streams) {
    return { allowed: false, limits, current, exceeded: "streams" };
  }
  if (current.views >= limits.views) {
    return { allowed: false, limits, current, exceeded: "views" };
  }
  if (current.apiRequestsToday >= limits.apiRequestsPerDay) {
    return { allowed: false, limits, current, exceeded: "api_requests" };
  }
  if (current.deliveriesThisMonth >= limits.deliveriesPerMonth) {
    return { allowed: false, limits, current, exceeded: "deliveries" };
  }
  if (current.storageBytes >= limits.storageBytes) {
    return { allowed: false, limits, current, exceeded: "storage" };
  }

  return { allowed: true, limits, current };
}

/**
 * Measure storage for all accounts by querying pg_total_relation_size
 * for each tenant's view schemas.
 */
export async function measureStorage(db: Kysely<Database>): Promise<void> {
  // Get all accounts with views
  const accountViews = await db
    .selectFrom("views")
    .innerJoin("api_keys", "views.api_key_id", "api_keys.id")
    .select(["api_keys.account_id", "views.schema_name"])
    .where("views.schema_name", "is not", null)
    .execute();

  // Group schemas by account
  const byAccount = new Map<string, string[]>();
  for (const row of accountViews) {
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
        totalBytes += Number((result.rows[0] as any)?.size ?? 0);
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
