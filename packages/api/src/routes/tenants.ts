/**
 * Platform-mode tenant lifecycle routes. Mounted only when
 * `INSTANCE_MODE === 'platform'` — the control plane owns tenant state.
 *
 * Routes:
 *   POST   /api/tenants          — provision new tenant (one per account)
 *   GET    /api/tenants/me       — current tenant for authenticated account
 *   POST   /api/tenants/me/resize — change plan (provisioner recreates containers)
 *   DELETE /api/tenants/me       — teardown (soft; volume preserved 30d)
 *
 * All routes require the account-scoped auth already applied upstream in
 * `packages/api/src/index.ts`.
 */

import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import {
	getTenantByAccount,
	insertTenant,
	setTenantStatus,
	updateTenantPlan,
} from "@secondlayer/shared/db/queries/tenants";
import { Hono } from "hono";
import { getAccountId } from "../lib/ownership.ts";
import {
	ProvisionerError,
	getTenantStatus,
	provisionTenant as provisionerProvision,
	resizeTenant as provisionerResize,
	teardownTenant as provisionerTeardown,
} from "../lib/provisioner-client.ts";
import { InvalidJSONError } from "../middleware/error.ts";

const VALID_PLANS = new Set(["launch", "grow", "scale", "enterprise"]);

type PlanId = "launch" | "grow" | "scale" | "enterprise";

const TRIAL_DAYS = 14;

const app = new Hono();

// ── POST /api/tenants — provision a new tenant ─────────────────────────

app.post("/", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const existing = await getTenantByAccount(getDb(), accountId);
	if (existing) {
		return c.json(
			{
				error: "Account already has a tenant",
				code: "TENANT_EXISTS",
				tenant: publicView(existing),
			},
			409,
		);
	}

	const body = (await c.req.json().catch(() => {
		throw new InvalidJSONError();
	})) as { plan?: unknown };
	if (typeof body.plan !== "string" || !VALID_PLANS.has(body.plan)) {
		return c.json(
			{ error: "plan must be one of: launch, grow, scale, enterprise" },
			400,
		);
	}
	const plan = body.plan as PlanId;

	let provisioned: Awaited<ReturnType<typeof provisionerProvision>>;
	try {
		provisioned = await provisionerProvision({ accountId, plan });
	} catch (err) {
		if (err instanceof ProvisionerError) {
			return c.json(
				{
					error: "Provisioner rejected the request",
					detail: err.body.slice(0, 500),
					status: err.status,
				},
				502,
			);
		}
		throw err;
	}

	const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 3600 * 1000);

	// Match plan alloc from packages/provisioner/src/plans.ts. Safe to
	// hardcode here — plan IDs are stable and we'd notice a drift on deploy
	// (provisioner would return a shape mismatch long before this).
	const alloc = PLAN_ALLOCATIONS[plan];

	const tenant = await insertTenant(getDb(), {
		accountId,
		slug: provisioned.slug,
		plan,
		cpus: alloc.cpus,
		memoryMb: alloc.memoryMb,
		storageLimitMb: alloc.storageLimitMb,
		pgContainerId: provisioned.containerIds.postgres,
		apiContainerId: provisioned.containerIds.api,
		processorContainerId: provisioned.containerIds.processor,
		targetDatabaseUrl: provisioned.targetDatabaseUrl,
		tenantJwtSecret: provisioned.tenantJwtSecret,
		anonKey: provisioned.anonKey,
		serviceKey: provisioned.serviceKey,
		apiUrlInternal: provisioned.apiUrlInternal,
		apiUrlPublic: provisioned.apiUrlPublic,
		trialEndsAt,
	});

	logger.info("Tenant provisioned", {
		slug: tenant.slug,
		plan,
		accountId,
	});

	return c.json(
		{
			tenant: publicView(tenant),
			credentials: {
				apiUrl: provisioned.apiUrlPublic,
				anonKey: provisioned.anonKey,
				serviceKey: provisioned.serviceKey,
			},
		},
		201,
	);
});

// ── GET /api/tenants/me — details + live container status ─────────────

app.get("/me", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const tenant = await getTenantByAccount(getDb(), accountId);
	if (!tenant) return c.json({ error: "No tenant for this account" }, 404);

	let status: Awaited<ReturnType<typeof getTenantStatus>> | null = null;
	try {
		status = await getTenantStatus(tenant.slug, tenant.plan);
	} catch (err) {
		logger.warn("Provisioner status fetch failed", {
			slug: tenant.slug,
			error: err instanceof Error ? err.message : String(err),
		});
	}

	return c.json({ tenant: publicView(tenant), runtime: status });
});

// ── POST /api/tenants/me/resize ───────────────────────────────────────

app.post("/me/resize", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const tenant = await getTenantByAccount(getDb(), accountId);
	if (!tenant) return c.json({ error: "No tenant for this account" }, 404);

	const body = (await c.req.json().catch(() => {
		throw new InvalidJSONError();
	})) as { plan?: unknown };
	if (typeof body.plan !== "string" || !VALID_PLANS.has(body.plan)) {
		return c.json(
			{ error: "plan must be one of: launch, grow, scale, enterprise" },
			400,
		);
	}
	const newPlan = body.plan as PlanId;

	if (newPlan === tenant.plan) {
		return c.json({ tenant: publicView(tenant), unchanged: true });
	}

	try {
		await provisionerResize(tenant.slug, newPlan);
	} catch (err) {
		if (err instanceof ProvisionerError) {
			return c.json({ error: "Resize failed", detail: err.body }, 502);
		}
		throw err;
	}

	const alloc = PLAN_ALLOCATIONS[newPlan];
	await updateTenantPlan(
		getDb(),
		tenant.slug,
		newPlan,
		alloc.cpus,
		alloc.memoryMb,
		alloc.storageLimitMb,
	);

	const refreshed = await getTenantByAccount(getDb(), accountId);
	if (!refreshed) {
		// Race: tenant was deleted while we were resizing. Unusual but not fatal.
		return c.json({ error: "Tenant vanished during resize" }, 500);
	}
	return c.json({ tenant: publicView(refreshed) });
});

// ── DELETE /api/tenants/me — soft teardown (volume preserved 30d) ────

app.delete("/me", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const tenant = await getTenantByAccount(getDb(), accountId);
	if (!tenant) return c.json({ error: "No tenant for this account" }, 404);

	try {
		await provisionerTeardown(tenant.slug, false);
	} catch (err) {
		if (err instanceof ProvisionerError) {
			return c.json({ error: "Teardown failed", detail: err.body }, 502);
		}
		throw err;
	}

	await setTenantStatus(getDb(), tenant.slug, "suspended");
	return c.json({
		message: `Tenant ${tenant.slug} suspended. Data preserved for 30 days.`,
	});
});

// ── Shared helpers ────────────────────────────────────────────────────

type TenantRow = Awaited<ReturnType<typeof getTenantByAccount>>;

function publicView(tenant: NonNullable<TenantRow>) {
	return {
		slug: tenant.slug,
		plan: tenant.plan,
		status: tenant.status,
		cpus: Number(tenant.cpus),
		memoryMb: tenant.memory_mb,
		storageLimitMb: tenant.storage_limit_mb,
		storageUsedMb: tenant.storage_used_mb,
		apiUrl: tenant.api_url_public,
		trialEndsAt: tenant.trial_ends_at,
		suspendedAt: tenant.suspended_at,
		createdAt: tenant.created_at,
	};
}

// Kept in sync with packages/provisioner/src/plans.ts. A mismatch would
// surface at provision time when the provisioner returns containers sized
// differently than what we record — monitoring should flag that drift.
const PLAN_ALLOCATIONS: Record<
	PlanId,
	{ cpus: number; memoryMb: number; storageLimitMb: number }
> = {
	launch: { cpus: 1, memoryMb: 2048, storageLimitMb: 10240 },
	grow: { cpus: 2, memoryMb: 4096, storageLimitMb: 51200 },
	scale: { cpus: 4, memoryMb: 8192, storageLimitMb: 204800 },
	enterprise: { cpus: 8, memoryMb: 32_768, storageLimitMb: -1 },
};

export default app;
