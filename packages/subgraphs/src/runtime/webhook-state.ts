import type { Database, Webhook } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { WebhookMatcher } from "./emitter-matcher.ts";

/**
 * Singleton matcher populated at processor startup and hot-reloaded via
 * `pg_notify('webhooks:changed')`. The block-processor reads from it
 * to decide which outbox rows to emit for each flushed write.
 */

export const matcher = new WebhookMatcher();

export async function refreshMatcher(db: Kysely<Database>): Promise<number> {
	const rows = await sql<Webhook>`
		SELECT * FROM webhooks WHERE status = 'active'
	`.execute(db);
	matcher.setAll(rows.rows);
	return matcher.size();
}
