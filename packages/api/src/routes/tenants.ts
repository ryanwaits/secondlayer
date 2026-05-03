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
	getAccountById,
	setAccountPlan,
} from "@secondlayer/shared/db/queries/accounts";
import { recordProvisioningAudit } from "@secondlayer/shared/db/queries/provisioning-audit";
import { computeEffectiveCompute } from "@secondlayer/shared/db/queries/tenant-compute-addons";
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
import { getPlan } from "@secondlayer/shared/pricing";
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
import { getStripeOrNull, resolveSubscriptionItem } from "../lib/stripe.ts";
import { getPriceIdForTier, isUpgradeableTier } from "../lib/tier-mapping.ts";
import { InvalidJSONError } from "../middleware/error.ts";

const VALID_PLANS = new Set(["launch", "scale", "enterprise"]);

/**
 * Plans a tenant owner is allowed to self-select via these endpoints.
 * Enterprise is intentionally excluded — it's custom-quoted per deal and
 * must be granted out-of-band (admin DB write or future admin endpoint).
 * Without this gate, any authenticated user could call POST /api/tenants
 * or /me/resize with `plan: "enterprise"` and get custom high-capacity RAM /
 * unlimited storage at no cost (enterprise has `monthlyPriceCents: null`,
 * so the Stripe sync block in /me/resize skips it entirely).
 */
const SELF_SERVE_PLANS = new Set(["launch", "scale"]);

type PlanId = "launch" | "scale" | "enterprise";

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
			{ error: "plan must be one of: launch, scale, enterprise" },
			400,
		);
	}
	if (!SELF_SERVE_PLANS.has(body.plan)) {
		return c.json(
			{
				error:
					"Enterprise is custom-quoted per deal — email hey@secondlayer.tools.",
				code: "PLAN_REQUIRES_SALES",
			},
			403,
		);
	}
	const plan = body.plan as PlanId;
	const account = await getAccountById(getDb(), accountId);
	if (!account) return c.json({ error: "Account not found" }, 404);
	if (account.plan !== plan) {
		return c.json(
			{
				error:
					"Start a 30-day trial or activate a subscription before provisioning this plan.",
				code: "SUBSCRIPTION_REQUIRED",
				accountPlan: account.plan,
				requestedPlan: plan,
			},
			409,
		);
	}

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

	const planDef = getPlan(plan);
	const alloc = {
		cpus: planDef.totalCpus,
		memoryMb: planDef.totalMemoryMb,
		storageLimitMb: planDef.storageLimitMb,
	};

	// Provisioner has already created containers + volumes + JWT secret on
	// the host. If the DB row insert fails (FK conflict, encryption error,
	// transient outage), those resources would be orphaned forever — and
	// the customer's Stripe customer/sub would still bill against a tenant
	// that doesn't formally exist. Tear down on insert failure.
	let tenant: Awaited<ReturnType<typeof insertTenant>>;
	try {
		tenant = await insertTenant(getDb(), {
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
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		logger.error(
			"insertTenant failed after successful provision; tearing down",
			{
				slug: provisioned.slug,
				accountId,
				error: msg,
			},
		);
		await provisionerTeardown(provisioned.slug, true).catch((teardownErr) => {
			logger.error("teardown after insertTenant failure also failed", {
				slug: provisioned.slug,
				accountId,
				error:
					teardownErr instanceof Error
						? teardownErr.message
						: String(teardownErr),
			});
		});
		await recordProvisioningAudit(getDb(), {
			accountId,
			actor: `account:${accountId}`,
			event: "provision.failure",
			status: "error",
			detail: { plan, slug: provisioned.slug, stage: "insertTenant" },
			error: msg,
		});
		throw err;
	}

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
		status = await getTenantStatus(
			tenant.slug,
			tenant.plan,
			tenant.storage_limit_mb,
		);
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
			{ error: "plan must be one of: launch, scale, enterprise" },
			400,
		);
	}
	if (!SELF_SERVE_PLANS.has(body.plan)) {
		return c.json(
			{
				error:
					"Enterprise resizes are handled by sales — email hey@secondlayer.tools.",
				code: "PLAN_REQUIRES_SALES",
			},
			403,
		);
	}
	// Once a tenant is on enterprise (admin-granted), resize via this
	// endpoint is also locked — there's almost certainly a custom contract
	// behind it that shouldn't be silently downgraded.
	if (tenant.plan === "enterprise") {
		return c.json(
			{
				error:
					"Resizing off enterprise requires sales review — email hey@secondlayer.tools.",
				code: "PLAN_REQUIRES_SALES",
			},
			403,
		);
	}
	const newPlan = body.plan as PlanId;

	if (newPlan === tenant.plan) {
		return c.json({ tenant: publicView(tenant), unchanged: true });
	}

	// **Provisioner runs BEFORE Stripe** so a Stripe failure doesn't leave
	// the customer paying for a tier they don't have. If Stripe fails after
	// a successful provisioner resize, the customer keeps the resource they
	// got (good UX), and we surface a "needs_billing_sync" alert for ops to
	// reconcile manually. Inverting this order produces the much-worse
	// "customer paid, didn't get the upgrade" state.
	const oldIsPaid = tenant.plan !== "enterprise";
	const newIsPaid = newPlan !== "enterprise";

	// If we'll need a Stripe price ID later, fail fast before we resize —
	// no point recreating containers if the env is misconfigured.
	if (newIsPaid && isUpgradeableTier(newPlan) && !getPriceIdForTier(newPlan)) {
		return c.json(
			{
				error: `Stripe price for ${newPlan} not configured (set STRIPE_PRICE_${newPlan.toUpperCase()})`,
			},
			503,
		);
	}

	// Provisioner resize first.
	const baseAlloc = getPlan(newPlan);
	const effective = await computeEffectiveCompute(getDb(), tenant.id, {
		cpus: baseAlloc.totalCpus,
		memoryMb: baseAlloc.totalMemoryMb,
		storageLimitMb: baseAlloc.storageLimitMb,
	});

	try {
		await provisionerResize(tenant.slug, {
			plan: newPlan,
			totalCpus: effective.cpus,
			totalMemoryMb: effective.memoryMb,
			storageLimitMb: effective.storageLimitMb,
		});
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

	// Cache effective compute on the tenants row — dashboard + billing read
	// from here without re-querying add-ons. Source of truth stays the
	// add-on table (if they get out of sync, `computeEffectiveCompute` wins).
	await updateTenantPlan(
		getDb(),
		tenant.slug,
		newPlan,
		effective.cpus,
		effective.memoryMb,
		effective.storageLimitMb,
	);

	// Stripe second. If this fails the resize itself succeeded; the
	// customer has the new resources and we're now under-billing them
	// until ops reconciles. Log loudly but don't return failure — that
	// would tell the user "your resize failed" when in fact they did
	// get the new resources.
	if (oldIsPaid && newIsPaid) {
		const stripe = getStripeOrNull();
		const account = await getAccountById(getDb(), accountId);
		if (stripe && account?.stripe_customer_id) {
			try {
				const sub = await resolveSubscriptionItem(
					stripe,
					account.stripe_customer_id,
				);
				if (sub) {
					if (newIsPaid && isUpgradeableTier(newPlan)) {
						// biome-ignore lint/style/noNonNullAssertion: pre-checked above
						const newPriceId = getPriceIdForTier(newPlan)!;
						await stripe.subscriptions.update(sub.subscriptionId, {
							items: [{ id: sub.itemId, price: newPriceId }],
							proration_behavior: "create_prorations",
						});
					}
				}
			} catch (err) {
				logger.error(
					"Stripe sync FAILED after successful provisioner resize — needs ops reconciliation",
					{
						accountId,
						slug: tenant.slug,
						from: tenant.plan,
						to: newPlan,
						err: err instanceof Error ? err.message : String(err),
					},
				);
				await recordProvisioningAudit(getDb(), {
					tenantId: tenant.id,
					tenantSlug: tenant.slug,
					accountId,
					actor: `account:${accountId}`,
					event: "resize",
					status: "error",
					detail: {
						from: tenant.plan,
						to: newPlan,
						stage: "stripe_sync",
						needs_billing_sync: true,
					},
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
	}

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
	if (tenant.status === "paused_limit") {
		return c.json(
			{
				error:
					"Tenant is paused at its plan limit. Upgrade to resume processing from the last processed block.",
				code: "LIMIT_UPGRADE_REQUIRED",
			},
			409,
		);
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
//
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

	// Cancel the Stripe subscription BEFORE teardown. Without this, a
	// paid customer who deletes their instance keeps getting billed
	// (containers gone, sub still active) until they notice — sometimes
	// months. Best-effort: log + continue if Stripe fails. Operator can
	// reconcile from `accounts.stripe_customer_id` lookup.
	const stripe = getStripeOrNull();
	if (stripe) {
		try {
			const account = await getAccountById(getDb(), accountId);
			if (account?.stripe_customer_id) {
				const sub = await resolveSubscriptionItem(
					stripe,
					account.stripe_customer_id,
				);
				if (sub) {
					await stripe.subscriptions.cancel(sub.subscriptionId, {
						invoice_now: true,
						prorate: true,
					});
					logger.info("Cancelled Stripe subscription on tenant delete", {
						accountId,
						subscriptionId: sub.subscriptionId,
					});
				}
			}
		} catch (err) {
			logger.error("Stripe sub cancel failed during tenant delete", {
				accountId,
				slug: tenant.slug,
				error: err instanceof Error ? err.message : String(err),
			});
			// Continue with teardown — leaving the customer with both an
			// active sub AND no service is worse than a billing error we
			// can reconcile.
		}
	}

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
	await setAccountPlan(getDb(), accountId, "none");
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
	const limitReason =
		tenant.status === "limit_warning"
			? "Storage is above 80% of the plan limit. Upgrade before processing pauses."
			: tenant.status === "paused_limit"
				? "Plan limit reached. Processing is paused until the tenant is upgraded."
				: null;
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
		limitReason,
		lastActiveAt: tenant.last_active_at,
		createdAt: tenant.created_at,
	};
}

export default app;
