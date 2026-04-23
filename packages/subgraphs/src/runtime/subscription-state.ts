import type { Database, Subscription } from "@secondlayer/shared/db";
import { listSubscriptions } from "@secondlayer/shared/db/queries/subscriptions";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { SubscriptionMatcher } from "./emitter-matcher.ts";

/**
 * Singleton matcher populated at processor startup and hot-reloaded via
 * `pg_notify('subscriptions:changed')`. The block-processor reads from it
 * to decide which outbox rows to emit for each flushed write.
 *
 * Per-account listing: in oss/dedicated mode the tenant DB holds all subs
 * for the single account; the matcher loads every row. In platform mode
 * the emitter doesn't run at all (control plane only), so this module is
 * dedicated/oss-only.
 */

export const matcher = new SubscriptionMatcher();

export async function refreshMatcher(db: Kysely<Database>): Promise<number> {
	// listSubscriptions is account-scoped; the emitter wants every active
	// sub so we do a raw query.
	const rows = await sql<Subscription>`
		SELECT * FROM subscriptions WHERE status = 'active'
	`.execute(db);
	matcher.setAll(rows.rows);
	return matcher.size();
}

// Per-account helper used by tests so the DATABASE_URL-based code path is
// exercised through listSubscriptions (keeps the query helper in the
// integration surface).
export async function refreshMatcherForAccount(
	db: Kysely<Database>,
	accountId: string,
): Promise<number> {
	const rows = await listSubscriptions(db, accountId);
	matcher.setAll(rows.filter((r: Subscription) => r.status === "active"));
	return matcher.size();
}
