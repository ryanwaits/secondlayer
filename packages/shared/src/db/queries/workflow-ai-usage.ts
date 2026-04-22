import { type Kysely, sql } from "kysely";
import { getAiCapForPlan } from "../../pricing.ts";
import type { Database, WorkflowAiUsageDaily } from "../types.ts";

/**
 * Daily AI eval usage — read by the workflow-runner before each AI
 * step, written after each successful call. Runner-dead today; lives
 * here so the runtime resurrection wires directly against a tested
 * surface.
 */

function todayUtc(): string {
	return new Date().toISOString().slice(0, 10); // yyyy-mm-dd
}

export async function getAiUsageToday(
	db: Kysely<Database>,
	tenantId: string,
): Promise<WorkflowAiUsageDaily | null> {
	const row = await db
		.selectFrom("workflow_ai_usage_daily")
		.selectAll()
		.where("tenant_id", "=", tenantId)
		.where("day", "=", todayUtc())
		.executeTakeFirst();
	return row ?? null;
}

/**
 * Atomic upsert — +1 eval and +cents onto today's row, creating the row
 * if missing. Runner is the sole caller; never decrement from elsewhere.
 */
export async function bumpAiUsage(
	db: Kysely<Database>,
	tenantId: string,
	costCents: number,
): Promise<void> {
	await sql`
		INSERT INTO workflow_ai_usage_daily (tenant_id, day, evals, cost_usd_cents, first_at, last_at)
		VALUES (${tenantId}, ${todayUtc()}::date, 1, ${costCents}, now(), now())
		ON CONFLICT (tenant_id, day) DO UPDATE SET
			evals          = workflow_ai_usage_daily.evals + 1,
			cost_usd_cents = workflow_ai_usage_daily.cost_usd_cents + EXCLUDED.cost_usd_cents,
			last_at        = now()
	`.execute(db);
}

/**
 * Gate check for the runner: is there headroom for another AI call?
 *
 * Returns `{ allowed, remaining }`. When `allowed === false`, the runner
 * should throw `AI_CAP_REACHED` so the step fails cleanly — workflows
 * with fallback branches continue, ones without degrade to "no action".
 *
 * Enterprise → always allowed (unlimited cap).
 */
export async function checkAiCapAvailable(
	db: Kysely<Database>,
	tenantId: string,
	plan: string,
): Promise<{ allowed: boolean; remaining: number; cap: number }> {
	const cap = getAiCapForPlan(plan).evalsPerDay;
	if (cap === Number.POSITIVE_INFINITY) {
		return { allowed: true, remaining: Number.POSITIVE_INFINITY, cap };
	}
	const usage = await getAiUsageToday(db, tenantId);
	const used = usage?.evals ?? 0;
	const remaining = Math.max(0, cap - used);
	return { allowed: used < cap, remaining, cap };
}
