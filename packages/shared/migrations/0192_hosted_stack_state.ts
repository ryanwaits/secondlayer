import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * `hosted_stack_state`: the platform's copy of each hosted stack's real state,
 * reported by the workload host (the owner of `tenants.state`). Replaces the
 * guess from `memory.gb_hour` heartbeats. No row = no stack reported yet.
 *
 * The CHECKs mirror `TENANT_STATES` and `STOP_REASONS` (workload
 * `control-db.ts`) and `HOSTED_STACK_STATES` (platform `hosted-stack-state.ts`).
 * `reported_at` is the workload host's observation time; an older report never
 * overwrites a newer one.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			CREATE TABLE IF NOT EXISTS hosted_stack_state (
				account_id  uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
				state       text NOT NULL
					CONSTRAINT hosted_stack_state_state_check
					CHECK (state IN ('provisioning', 'running', 'stopped', 'destroyed')),
				stop_reason text
					CONSTRAINT hosted_stack_state_stop_reason_check
					CHECK (stop_reason IN ('credits', 'cap', 'idle')),
				reported_at timestamptz NOT NULL,
				CONSTRAINT hosted_stack_state_stop_reason_iff_stopped
					CHECK ((state = 'stopped') = (stop_reason IS NOT NULL))
			)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS hosted_stack_state`.execute(db);
	});
}
