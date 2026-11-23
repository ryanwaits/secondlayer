import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

/** Mirrors the workload control DB's `TENANT_STATES` and the table CHECK. */
export const HOSTED_STACK_STATES = [
	"provisioning",
	"running",
	"stopped",
	"destroyed",
] as const;
export type HostedStackState = (typeof HOSTED_STACK_STATES)[number];

export const HOSTED_STACK_STOP_REASONS = ["credits", "cap", "idle"] as const;
export type HostedStackStopReason = (typeof HOSTED_STACK_STOP_REASONS)[number];

export type ServiceState =
	| "none"
	| "provisioning"
	| "running"
	| "stopped_credits"
	| "stopped_cap"
	| "stopped_idle";

export type StackStateReport = {
	accountId: string;
	state: HostedStackState;
	stopReason: HostedStackStopReason | null;
	observedAt: Date;
};

export function serviceStateOf(
	row: {
		state: HostedStackState;
		stop_reason: HostedStackStopReason | null;
	} | null,
): ServiceState {
	if (!row) return "none";
	switch (row.state) {
		case "provisioning":
		case "running":
			return row.state;
		case "stopped":
			return `stopped_${row.stop_reason ?? "credits"}`;
		case "destroyed":
			return "none";
	}
}

export function isBillingStop(state: ServiceState): boolean {
	return state === "stopped_credits" || state === "stopped_cap";
}

export function legacyServiceState(
	state: ServiceState,
): "running" | "stopped" | "none" {
	if (state === "running") return "running";
	return state.startsWith("stopped_") ? "stopped" : "none";
}

export async function upsertStackStates(
	db: Kysely<Database>,
	reports: StackStateReport[],
): Promise<number> {
	// Latest observation wins within one batch (an upsert cannot touch the
	// same row twice in one statement).
	const latest = new Map<string, StackStateReport>();
	for (const r of reports) {
		const seen = latest.get(r.accountId);
		if (!seen || r.observedAt >= seen.observedAt) latest.set(r.accountId, r);
	}
	if (latest.size === 0) return 0;
	const known = await db
		.selectFrom("accounts")
		.select("id")
		.where("id", "in", [...latest.keys()])
		.execute();
	const rows = known.map(({ id }) => {
		const r = latest.get(id) as StackStateReport;
		return {
			account_id: id,
			state: r.state,
			stop_reason: r.stopReason,
			reported_at: r.observedAt,
		};
	});
	if (rows.length === 0) return 0;
	const applied = await db
		.insertInto("hosted_stack_state")
		.values(rows)
		.onConflict((oc) =>
			oc
				.column("account_id")
				.doUpdateSet((eb) => ({
					state: eb.ref("excluded.state"),
					stop_reason: eb.ref("excluded.stop_reason"),
					reported_at: eb.ref("excluded.reported_at"),
				}))
				.where("hosted_stack_state.reported_at", "<=", (eb) =>
					eb.ref("excluded.reported_at"),
				),
		)
		.returning("account_id")
		.execute();
	return applied.length;
}

export async function getServiceState(
	db: Kysely<Database>,
	accountId: string,
): Promise<ServiceState> {
	const row = await db
		.selectFrom("hosted_stack_state")
		.select(["state", "stop_reason"])
		.where("account_id", "=", accountId)
		.executeTakeFirst();
	return serviceStateOf(row ?? null);
}
