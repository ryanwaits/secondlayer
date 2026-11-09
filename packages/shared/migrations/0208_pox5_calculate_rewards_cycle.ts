import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

// `calculate-rewards` prints its reward cycle as `stx-cycle`, but the decoder
// left `reward_cycle` null, so `?reward_cycle=` never found those rows. The
// decoder now promotes it; fill history from the stored `data` (a few dozen
// rows). Skipped when the table is absent.
async function tableExists(db: Kysely<unknown>, table: string) {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists === true;
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onChainPlane(async () => {
		if (!(await tableExists(db, "pox5_events"))) return;
		await sql`
			UPDATE pox5_events
			SET reward_cycle = (data->>'stx-cycle')::integer
			WHERE topic = 'calculate-rewards'
				AND reward_cycle IS NULL
				AND data->>'stx-cycle' ~ '^[0-9]{1,9}$'
		`.execute(db);
	});
}

export async function down(): Promise<void> {
	// Data-only fill of values the decoder now writes; nothing to undo.
}
