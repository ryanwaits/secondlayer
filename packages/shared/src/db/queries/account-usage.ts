import { type Kysely, sql } from "kysely";
import {
	type TokenUsage,
	computeUsdCost,
	getAiCapForPlan,
	getComputeAllowanceHours,
	getStorageAllowanceBytes,
} from "../../pricing.ts";
import type { Database } from "../types.ts";

/**
 * Rollup queries that power the `/platform/usage` page.
 *
 * Compute-hours approximation: each active tenant contributes
 *   cpus × hours-in-period-while-active
 * where "active" is approximated from `last_active_at`. This undercounts
 * tenants that went idle between cron ticks and overcounts nothing.
 *
 * Actual Stripe billing happens in `packages/worker/src/jobs/compute-metering.ts`
 * — these numbers are for display only. Follow-up work: write-through
 * compute ledger so this query reads truth instead of estimating.
 */

const IDLE_GRACE_MS = 2 * 60 * 60 * 1000; // 2h
const BYTES_PER_MB = 1024 * 1024;

// ── Types ────────────────────────────────────────────────────────────

export interface SparklinePoint {
	day: string; // YYYY-MM-DD
	value: number;
}

export interface ComputeUsage {
	usedHours: number;
	allowanceHours: number;
	pct: number;
	sparkline: SparklinePoint[];
}

export interface StorageUsage {
	usedBytes: number;
	allowanceBytes: number;
	pct: number;
	sparkline: SparklinePoint[];
}

export interface AiUsage {
	todayCount: number;
	periodCount: number;
	dailyCap: number;
	pct: number;
	sparkline: SparklinePoint[];
}

export interface ProjectRow {
	id: string;
	slug: string;
	name: string;
	status: string;
	subgraphCount: number;
	compute: { hours: number; pct: number };
	storage: { bytes: number; pct: number };
	aiEvals: { todayCount: number; pct: number };
}

// ── Helpers ──────────────────────────────────────────────────────────

function toDayKey(d: Date): string {
	return d.toISOString().slice(0, 10);
}

function* lastNDays(n: number, endInclusive: Date): Generator<string> {
	const end = new Date(endInclusive);
	for (let i = n - 1; i >= 0; i--) {
		const d = new Date(end);
		d.setUTCDate(d.getUTCDate() - i);
		yield toDayKey(d);
	}
}

function computeActiveHours(
	periodStart: Date,
	now: Date,
	tenant: {
		created_at: Date;
		last_active_at: Date;
		status: string;
	},
): number {
	if (tenant.status !== "active") return 0;
	const rangeStart = Math.max(
		periodStart.getTime(),
		tenant.created_at.getTime(),
	);
	const rangeEnd = Math.min(
		now.getTime(),
		tenant.last_active_at.getTime() + IDLE_GRACE_MS,
	);
	if (rangeEnd <= rangeStart) return 0;
	return (rangeEnd - rangeStart) / (1000 * 60 * 60);
}

function pct(used: number, allowance: number): number {
	if (!Number.isFinite(allowance) || allowance <= 0) return 0;
	return Math.min((used / allowance) * 100, 100);
}

// ── Queries ──────────────────────────────────────────────────────────

export async function getComputeUsage(
	db: Kysely<Database>,
	accountId: string,
	plan: string,
	periodStart: Date,
	now: Date = new Date(),
): Promise<ComputeUsage> {
	const tenants = await db
		.selectFrom("tenants")
		.select(["id", "cpus", "status", "created_at", "last_active_at"])
		.where("account_id", "=", accountId)
		.where("status", "!=", "deleted")
		.execute();

	let totalHours = 0;
	for (const t of tenants) {
		const hours = computeActiveHours(periodStart, now, {
			created_at: t.created_at,
			last_active_at: t.last_active_at,
			status: String(t.status),
		});
		totalHours += hours * Number(t.cpus);
	}

	const allowance = getComputeAllowanceHours(plan);

	// 14-day sparkline: bucket the same formula per-day.
	const sparkline: SparklinePoint[] = [];
	for (const day of lastNDays(14, now)) {
		const dayStart = new Date(`${day}T00:00:00.000Z`);
		const dayEnd = new Date(`${day}T23:59:59.999Z`);
		let dayHours = 0;
		for (const t of tenants) {
			const hours = computeActiveHours(dayStart, dayEnd, {
				created_at: t.created_at,
				last_active_at: t.last_active_at,
				status: String(t.status),
			});
			dayHours += Math.min(hours, 24) * Number(t.cpus);
		}
		sparkline.push({ day, value: dayHours });
	}

	return {
		usedHours: totalHours,
		allowanceHours: allowance,
		pct: pct(totalHours, allowance),
		sparkline,
	};
}

export async function getStorageUsage(
	db: Kysely<Database>,
	accountId: string,
	plan: string,
	now: Date = new Date(),
): Promise<StorageUsage> {
	// Current usage: sum of tenants.storage_used_mb for this account.
	const current = await db
		.selectFrom("tenants")
		.select(sql<string>`COALESCE(SUM(storage_used_mb), 0)`.as("mb"))
		.where("account_id", "=", accountId)
		.where("status", "!=", "deleted")
		.executeTakeFirst();

	const usedBytes = Number(current?.mb ?? 0) * BYTES_PER_MB;
	const allowance = getStorageAllowanceBytes(plan);

	// 14-day sparkline: per-month snapshots only — fall back to a flat
	// line at the current value. When per-day storage history lands, swap
	// this for a real bucket query.
	const sparkline: SparklinePoint[] = [];
	for (const day of lastNDays(14, now)) {
		sparkline.push({ day, value: Number(current?.mb ?? 0) });
	}

	return {
		usedBytes,
		allowanceBytes: allowance,
		pct: pct(usedBytes, allowance),
		sparkline,
	};
}

export async function getAiUsage(
	db: Kysely<Database>,
	accountId: string,
	plan: string,
	periodStart: Date,
	now: Date = new Date(),
): Promise<AiUsage> {
	const cap = getAiCapForPlan(plan);
	const dailyCap = cap.evalsPerDay;
	const todayKey = toDayKey(now);
	const periodStartKey = toDayKey(periodStart);

	const rows = await db
		.selectFrom("workflow_ai_usage_daily")
		.select(["day", sql<string>`SUM(evals)`.as("evals")])
		.where("account_id", "=", accountId)
		.where("day", ">=", periodStartKey)
		.groupBy("day")
		.execute();

	const byDay = new Map<string, number>();
	for (const r of rows) byDay.set(String(r.day), Number(r.evals));

	const todayCount = byDay.get(todayKey) ?? 0;
	let periodCount = 0;
	for (const v of byDay.values()) periodCount += v;

	const sparkline: SparklinePoint[] = [];
	for (const day of lastNDays(14, now)) {
		sparkline.push({ day, value: byDay.get(day) ?? 0 });
	}

	return {
		todayCount,
		periodCount,
		dailyCap,
		pct: pct(todayCount, dailyCap),
		sparkline,
	};
}

/**
 * Fire-and-forget UPSERT that bumps today's AI usage counter. Called
 * from the `workflows/ai.ts` middleware after every generate call.
 * Costs come from the provider pricing table in `pricing.ts`; unknown
 * (provider, model) pairs don't bump `cost_usd_cents`.
 */
export async function bumpAiUsage(
	db: Kysely<Database>,
	opts: {
		accountId: string;
		tenantId: string | null;
		provider: string;
		modelId: string;
		usage: TokenUsage;
	},
): Promise<void> {
	const today = new Date().toISOString().slice(0, 10);
	const costUsd = computeUsdCost(opts.provider, opts.modelId, opts.usage) ?? 0;
	const costCents = Math.round(costUsd * 100);

	// Use raw SQL because Kysely's onConflict doesn't support
	// `NULLS NOT DISTINCT` — which we need for (account_id, NULL, day)
	// uniqueness on sentry runs.
	await sql`
		INSERT INTO workflow_ai_usage_daily
			(account_id, tenant_id, day, evals, cost_usd_cents)
		VALUES
			(${opts.accountId}, ${opts.tenantId}, ${today}, 1, ${costCents})
		ON CONFLICT (account_id, tenant_id, day) DO UPDATE SET
			evals = workflow_ai_usage_daily.evals + 1,
			cost_usd_cents = workflow_ai_usage_daily.cost_usd_cents + EXCLUDED.cost_usd_cents,
			last_at = NOW()
	`.execute(db);
}

export async function getProjectBreakdown(
	db: Kysely<Database>,
	accountId: string,
	plan: string,
	periodStart: Date,
	now: Date = new Date(),
): Promise<ProjectRow[]> {
	const tenants = await db
		.selectFrom("tenants")
		.select([
			"id",
			"slug",
			"status",
			"cpus",
			"storage_used_mb",
			"created_at",
			"last_active_at",
		])
		.where("account_id", "=", accountId)
		.where("status", "!=", "deleted")
		.orderBy("created_at", "desc")
		.execute();

	if (tenants.length === 0) return [];

	const tenantIds = tenants.map((t) => t.id);
	const todayKey = toDayKey(now);

	// AI today per tenant
	const aiRows = await db
		.selectFrom("workflow_ai_usage_daily")
		.select(["tenant_id", sql<string>`SUM(evals)`.as("evals")])
		.where("tenant_id", "in", tenantIds)
		.where("day", "=", todayKey)
		.groupBy("tenant_id")
		.execute();
	const aiByTenant = new Map<string, number>();
	for (const r of aiRows) aiByTenant.set(String(r.tenant_id), Number(r.evals));

	const computeAllowance = getComputeAllowanceHours(plan);
	const storageAllowance = getStorageAllowanceBytes(plan);
	const aiDailyCap = getAiCapForPlan(plan).evalsPerDay;

	return tenants.map((t) => {
		const hours =
			computeActiveHours(periodStart, now, {
				created_at: t.created_at,
				last_active_at: t.last_active_at,
				status: String(t.status),
			}) * Number(t.cpus);
		const bytes = Number(t.storage_used_mb ?? 0) * BYTES_PER_MB;
		const todayAi = aiByTenant.get(t.id) ?? 0;

		return {
			id: t.id,
			slug: t.slug,
			name: t.slug,
			status: String(t.status),
			// subgraphCount not tracked at account-DB level (subgraphs live on
			// per-tenant DBs). Left at 0; later pass can ping each tenant API.
			subgraphCount: 0,
			compute: { hours, pct: pct(hours, computeAllowance) },
			storage: { bytes, pct: pct(bytes, storageAllowance) },
			aiEvals: { todayCount: todayAi, pct: pct(todayAi, aiDailyCap) },
		};
	});
}
