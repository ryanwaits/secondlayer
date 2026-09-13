import type { Database, Webhook } from "@secondlayer/shared/db";
import { listWebhooks } from "@secondlayer/shared/db/queries/webhooks";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { WebhookMatcher } from "./emitter-matcher.ts";

/**
 * Singleton matcher populated at processor startup and hot-reloaded via
 * `pg_notify('webhooks:changed')`. The block-processor reads from it
 * to decide which outbox rows to emit for each flushed write.
 *
 * Per-account listing: in oss/dedicated mode the tenant DB holds all subs
 * for the single account; the matcher loads every row. In platform mode
 * the emitter doesn't run at all (control plane only), so this module is
 * dedicated/oss-only.
 */

export const matcher = new WebhookMatcher();

export async function refreshMatcher(db: Kysely<Database>): Promise<number> {
	// listWebhooks is account-scoped; the emitter wants every active
	// sub so we do a raw query.
	const rows = await sql<Webhook>`
		SELECT * FROM webhooks WHERE status = 'active'
	`.execute(db);
	matcher.setAll(rows.rows);
	return matcher.size();
}

// Per-account helper used by tests so the DATABASE_URL-based code path is
// exercised through listWebhooks (keeps the query helper in the
// integration surface).
export async function refreshMatcherForAccount(
	db: Kysely<Database>,
	accountId: string,
): Promise<number> {
	const rows = await listWebhooks(db, accountId);
	matcher.setAll(rows.filter((r: Webhook) => r.status === "active"));
	return matcher.size();
}
