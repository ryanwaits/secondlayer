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
import { recordProvisioningAudit } from "@secondlayer/shared/db/queries/provisioning-audit";
import {
	bumpTenantKeyGen,
	deleteTenant,
	getTenantByAccount,
	getTenantCredentials,
	insertTenant,
	setTenantStatus,
	updateTenantKeys,
	updateTenantPlan,
} from "@secondlayer/shared/db/queries/tenants";
import { Hono } from "hono";
import { mintEphemeralServiceJwt } from "../lib/ephemeral-jwt.ts";
import { getAccountId } from "../lib/ownership.ts";
import {
	ProvisionerError,
	getTenantStatus,
	addBastionUser as provisionerAddBastionUser,
	provisionTenant as provisionerProvision,
	removeBastionUser as provisionerRemoveBastionUser,
	resizeTenant as provisionerResize,
	resumeTenant as provisionerResume,
	rotateTenantKeys as provisionerRotate,
	suspendTenant as provisionerSuspend,
	teardownTenant as provisionerTeardown,
} from "../lib/provisioner-client.ts";
import { InvalidJSONError } from "../middleware/error.ts";

const VALID_PLANS = new Set(["launch", "grow", "scale", "enterprise"]);

type PlanId = "launch" | "grow" | "scale" | "enterprise";

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

	await recordProvisioningAudit(getDb(), {
		accountId,
		actor: `account:${accountId}`,
		event: "provision.start",
		status: "ok",
		detail: { plan },
	});

	let provisioned: Awaited<ReturnType<typeof provisionerProvision>>;
	try {
		provisioned = await provisionerProvision({ accountId, plan });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		await recordProvisioningAudit(getDb(), {
			accountId,
			actor: `account:${accountId}`,
			event: "provision.failure",
			status: "error",
			detail: { plan },
			error: msg,
		});
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
	});

	logger.info("Tenant provisioned", {
		slug: tenant.slug,
		plan,
		accountId,
	});

	await recordProvisioningAudit(getDb(), {
		tenantId: tenant.id,
		tenantSlug: tenant.slug,
		accountId,
		actor: `account:${accountId}`,
		event: "provision.success",
		status: "ok",
		detail: { plan },
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
		await recordProvisioningAudit(getDb(), {
			tenantId: tenant.id,
			tenantSlug: tenant.slug,
			accountId,
			actor: `account:${accountId}`,
			event: "resize",
			status: "error",
			detail: { from: tenant.plan, to: newPlan },
			error: err instanceof Error ? err.message : String(err),
		});
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

	await recordProvisioningAudit(getDb(), {
		tenantId: tenant.id,
		tenantSlug: tenant.slug,
		accountId,
		actor: `account:${accountId}`,
		event: "resize",
		status: "ok",
		detail: { from: tenant.plan, to: newPlan },
	});

	const refreshed = await getTenantByAccount(getDb(), accountId);
	if (!refreshed) {
		// Race: tenant was deleted while we were resizing. Unusual but not fatal.
		return c.json({ error: "Tenant vanished during resize" }, 500);
	}
	return c.json({ tenant: publicView(refreshed) });
});

// ── POST /api/tenants/me/suspend — stop containers, keep volume ───────

app.post("/me/suspend", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const tenant = await getTenantByAccount(getDb(), accountId);
	if (!tenant) return c.json({ error: "No tenant for this account" }, 404);
	if (tenant.status === "suspended") {
		return c.json({ tenant: publicView(tenant), unchanged: true });
	}

	try {
		await provisionerSuspend(tenant.slug);
	} catch (err) {
		await recordProvisioningAudit(getDb(), {
			tenantId: tenant.id,
			tenantSlug: tenant.slug,
			accountId,
			actor: `account:${accountId}`,
			event: "suspend",
			status: "error",
			error: err instanceof Error ? err.message : String(err),
		});
		if (err instanceof ProvisionerError) {
			return c.json({ error: "Suspend failed", detail: err.body }, 502);
		}
		throw err;
	}
	await setTenantStatus(getDb(), tenant.slug, "suspended");
	await recordProvisioningAudit(getDb(), {
		tenantId: tenant.id,
		tenantSlug: tenant.slug,
		accountId,
		actor: `account:${accountId}`,
		event: "suspend",
		status: "ok",
	});
	const refreshed = await getTenantByAccount(getDb(), accountId);
	return c.json({ tenant: publicView(refreshed ?? tenant) });
});

// ── POST /api/tenants/me/resume — start containers ───────────────────

app.post("/me/resume", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const tenant = await getTenantByAccount(getDb(), accountId);
	if (!tenant) return c.json({ error: "No tenant for this account" }, 404);
	if (tenant.status === "active") {
		return c.json({ tenant: publicView(tenant), unchanged: true });
	}

	try {
		await provisionerResume(tenant.slug);
	} catch (err) {
		await recordProvisioningAudit(getDb(), {
			tenantId: tenant.id,
			tenantSlug: tenant.slug,
			accountId,
			actor: `account:${accountId}`,
			event: "resume",
			status: "error",
			error: err instanceof Error ? err.message : String(err),
		});
		if (err instanceof ProvisionerError) {
			return c.json({ error: "Resume failed", detail: err.body }, 502);
		}
		throw err;
	}
	await setTenantStatus(getDb(), tenant.slug, "active");
	await recordProvisioningAudit(getDb(), {
		tenantId: tenant.id,
		tenantSlug: tenant.slug,
		accountId,
		actor: `account:${accountId}`,
		event: "resume",
		status: "ok",
	});
	const refreshed = await getTenantByAccount(getDb(), accountId);
	return c.json({ tenant: publicView(refreshed ?? tenant) });
});

// ── POST /api/tenants/me/keys/rotate — rotate JWT(s) ─────────────────
//
// Body: `{ type: "service" | "anon" | "both" }`. Bumps gen counter(s) in
// platform DB, forwards to provisioner which recreates the tenant API
// container with new SERVICE_GEN / ANON_GEN env + mints replacements.
// Returns the rotated key(s) ONCE — caller must persist client-side.

app.post("/me/keys/rotate", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const tenant = await getTenantByAccount(getDb(), accountId);
	if (!tenant) return c.json({ error: "No tenant for this account" }, 404);

	const body = (await c.req.json().catch(() => {
		throw new InvalidJSONError();
	})) as { type?: unknown };
	if (body.type !== "service" && body.type !== "anon" && body.type !== "both") {
		return c.json({ error: "type must be: service, anon, or both" }, 400);
	}
	const type = body.type;

	// Bump gen counters first so if the provisioner call fails, the old
	// tokens are still invalid-to-be (the tenant API container still has the
	// old gen until it's recreated, so old tokens keep working — but the
	// NEW expected gen is already on file). Acceptable race: a rotate that
	// fails mid-flight can be retried with the same `type`, no drift.
	const newGens = await bumpTenantKeyGen(getDb(), tenant.slug, type);

	let rotated: { serviceKey?: string; anonKey?: string };
	try {
		rotated = await provisionerRotate(tenant.slug, {
			type,
			plan: tenant.plan,
			newServiceGen: newGens.serviceGen,
			newAnonGen: newGens.anonGen,
		});
	} catch (err) {
		await recordProvisioningAudit(getDb(), {
			tenantId: tenant.id,
			tenantSlug: tenant.slug,
			accountId,
			actor: `account:${accountId}`,
			event: "keys.rotate",
			status: "error",
			detail: { type },
			error: err instanceof Error ? err.message : String(err),
		});
		if (err instanceof ProvisionerError) {
			return c.json({ error: "Rotate failed", detail: err.body }, 502);
		}
		throw err;
	}

	// Persist new encrypted key(s) so future requests for tenant creds
	// surface the current values.
	await updateTenantKeys(getDb(), tenant.slug, rotated);

	await recordProvisioningAudit(getDb(), {
		tenantId: tenant.id,
		tenantSlug: tenant.slug,
		accountId,
		actor: `account:${accountId}`,
		event: "keys.rotate",
		status: "ok",
		detail: { type, serviceGen: newGens.serviceGen, anonGen: newGens.anonGen },
	});

	return c.json({
		type,
		rotated,
		serviceGen: newGens.serviceGen,
		anonGen: newGens.anonGen,
	});
});

// ── POST /api/tenants/me/keys/mint-ephemeral — short-lived service JWT ─
//
// Session-authed caller gets back a 5-min JWT the CLI uses to hit the
// tenant directly. Signed with the tenant's stored `tenant_jwt_secret`
// + current `service_gen`, so the tenant API's existing auth middleware
// validates it without any new code path.

app.post("/me/keys/mint-ephemeral", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const tenant = await getTenantByAccount(getDb(), accountId);
	if (!tenant) return c.json({ error: "No tenant for this account" }, 404);

	const creds = await getTenantCredentials(getDb(), tenant.slug);
	if (!creds) {
		return c.json({ error: "Tenant credentials unavailable" }, 500);
	}

	const ephemeral = await mintEphemeralServiceJwt({
		secret: creds.tenantJwtSecret,
		slug: tenant.slug,
		serviceGen: tenant.service_gen,
	});
	return c.json({
		apiUrl: tenant.api_url_public,
		serviceKey: ephemeral.serviceKey,
		expiresAt: ephemeral.expiresAt,
	});
});

// ── GET /api/tenants/me/db-access — SSH-tunnel connection details ─────
//
// Returns everything the CLI needs to print a working `ssh -L` + DATABASE_URL
// template. Tenant pg is never exposed publicly; users tunnel through the
// bastion which enforces per-user PermitOpen. This endpoint does NOT add
// the user's pubkey — `POST /api/tenants/me/db-access/key` does that.

app.get("/me/db-access", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const tenant = await getTenantByAccount(getDb(), accountId);
	if (!tenant) return c.json({ error: "No tenant for this account" }, 404);

	const creds = await getTenantCredentials(getDb(), tenant.slug);
	if (!creds) return c.json({ error: "Tenant credentials unavailable" }, 500);

	// Parse the stored target URL to pull out just the password — the host
	// portion is the in-cluster `sl-pg-<slug>` alias which isn't useful
	// client-side. Rewrite to a localhost-tunneled URL at `localPort`.
	const parsed = new URL(creds.targetDatabaseUrl);
	const password = decodeURIComponent(parsed.password);
	const bastionHost =
		process.env.BASTION_PUBLIC_HOST ??
		`bastion.${process.env.BASE_DOMAIN ?? "secondlayer.tools"}`;
	const bastionPort = Number(process.env.BASTION_PUBLIC_PORT ?? 2222);
	const localPort = 5432;
	const pgContainer = `sl-pg-${tenant.slug}`;
	const bastionUser = `tenant-${tenant.slug}`;

	return c.json({
		slug: tenant.slug,
		bastionHost,
		bastionPort,
		bastionUser,
		pgContainer,
		localPort,
		sshCommand: `ssh -N -L ${localPort}:${pgContainer}:5432 ${bastionUser}@${bastionHost} -p ${bastionPort}`,
		databaseUrl: `postgres://secondlayer:${encodeURIComponent(password)}@localhost:${localPort}/secondlayer`,
	});
});

// ── POST /api/tenants/me/db-access/key — upload/rotate bastion pubkey ──

app.post("/me/db-access/key", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const tenant = await getTenantByAccount(getDb(), accountId);
	if (!tenant) return c.json({ error: "No tenant for this account" }, 404);

	const body = (await c.req.json().catch(() => {
		throw new InvalidJSONError();
	})) as { publicKey?: unknown };
	if (typeof body.publicKey !== "string" || !body.publicKey.trim()) {
		return c.json({ error: "publicKey is required" }, 400);
	}

	try {
		await provisionerAddBastionUser(tenant.slug, body.publicKey);
	} catch (err) {
		await recordProvisioningAudit(getDb(), {
			tenantId: tenant.id,
			tenantSlug: tenant.slug,
			accountId,
			actor: `account:${accountId}`,
			event: "bastion.key.upload",
			status: "error",
			error: err instanceof Error ? err.message : String(err),
		});
		if (err instanceof ProvisionerError) {
			return c.json({ error: "Bastion update failed", detail: err.body }, 502);
		}
		throw err;
	}

	await recordProvisioningAudit(getDb(), {
		tenantId: tenant.id,
		tenantSlug: tenant.slug,
		accountId,
		actor: `account:${accountId}`,
		event: "bastion.key.upload",
		status: "ok",
	});
	return c.json({ slug: tenant.slug, user: `tenant-${tenant.slug}` });
});

// ── DELETE /api/tenants/me/db-access/key — revoke bastion access ─────

app.delete("/me/db-access/key", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const tenant = await getTenantByAccount(getDb(), accountId);
	if (!tenant) return c.json({ error: "No tenant for this account" }, 404);

	try {
		await provisionerRemoveBastionUser(tenant.slug);
	} catch (err) {
		await recordProvisioningAudit(getDb(), {
			tenantId: tenant.id,
			tenantSlug: tenant.slug,
			accountId,
			actor: `account:${accountId}`,
			event: "bastion.key.revoke",
			status: "error",
			error: err instanceof Error ? err.message : String(err),
		});
		if (err instanceof ProvisionerError) {
			return c.json({ error: "Bastion update failed", detail: err.body }, 502);
		}
		throw err;
	}
	await recordProvisioningAudit(getDb(), {
		tenantId: tenant.id,
		tenantSlug: tenant.slug,
		accountId,
		actor: `account:${accountId}`,
		event: "bastion.key.revoke",
		status: "ok",
	});
	return c.json({ slug: tenant.slug, removed: true });
});

// ── DELETE /api/tenants/me — hard teardown + row removal ─────────────

app.delete("/me", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	const tenant = await getTenantByAccount(getDb(), accountId);
	if (!tenant) return c.json({ error: "No tenant for this account" }, 404);

	try {
		await provisionerTeardown(tenant.slug, true);
	} catch (err) {
		await recordProvisioningAudit(getDb(), {
			tenantId: tenant.id,
			tenantSlug: tenant.slug,
			accountId,
			actor: `account:${accountId}`,
			event: "teardown",
			status: "error",
			error: err instanceof Error ? err.message : String(err),
		});
		if (err instanceof ProvisionerError) {
			return c.json({ error: "Teardown failed", detail: err.body }, 502);
		}
		throw err;
	}

	await deleteTenant(getDb(), tenant.slug);
	// Record AFTER deleteTenant so the FK cascade (ON DELETE SET NULL for
	// tenant_id) leaves the audit row intact with the slug preserved.
	await recordProvisioningAudit(getDb(), {
		tenantSlug: tenant.slug,
		accountId,
		actor: `account:${accountId}`,
		event: "teardown",
		status: "ok",
	});
	return c.json({
		message: `Tenant ${tenant.slug} deleted.`,
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
		suspendedAt: tenant.suspended_at,
		lastActiveAt: tenant.last_active_at,
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
