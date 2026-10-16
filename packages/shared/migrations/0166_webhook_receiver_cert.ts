import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * `webhooks.receiver_cert_expires_at` / `receiver_cert_checked_at` — the
 * receiver's TLS leaf certificate expiry and when the emitter's periodic
 * probe last looked. Bun's `fetch` can't expose the peer certificate, so the
 * emitter probes each https origin out of band (see subgraphs
 * `runtime/receiver-cert.ts`).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE webhooks
			ADD COLUMN IF NOT EXISTS receiver_cert_expires_at TIMESTAMPTZ,
			ADD COLUMN IF NOT EXISTS receiver_cert_checked_at TIMESTAMPTZ
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE webhooks
			DROP COLUMN IF EXISTS receiver_cert_expires_at,
			DROP COLUMN IF EXISTS receiver_cert_checked_at
		`.execute(db);
	});
}
