/** Test-only: put a tenant row in any state, bypassing the transition table.
 *  Fixtures need rows in states the real transitions only reach through a
 *  compose run. Never imported by production code. */

import type postgres from "postgres";
import type { StopReason, TenantState } from "./control-db.ts";

export async function forceTenantState(
	db: postgres.Sql,
	accountId: string,
	state: TenantState,
	stopReason: StopReason = "credits",
): Promise<void> {
	const reason = state === "stopped" ? stopReason : null;
	await db`
		UPDATE tenants
		SET state = ${state},
			stop_reason = ${reason},
			stopped_at = ${state === "stopped" ? db`now()` : null},
			started_at = ${state === "running" ? db`now()` : null}
		WHERE account_id = ${accountId}
	`;
}
