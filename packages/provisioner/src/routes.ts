/**
 * Provisioner HTTP API. Mounted by `index.ts`. All routes gated by the
 * shared `PROVISIONER_SECRET` sent in `X-Provisioner-Secret` — this is the
 * only trust boundary between control plane and provisioner.
 *
 * Exception: `/internal/caddy/ask` is unauth — it's called by the in-cluster
 * Caddy reverse proxy to validate on-demand TLS cert requests.
 */

import { Hono, type MiddlewareHandler } from "hono";
import { addBastionUser, removeBastionUser } from "./bastion.ts";
import { getConfig } from "./config.ts";
import { containerInspect } from "./docker.ts";
import {
	type KeyRotateType,
	getTenantStatus,
	resizeTenant,
	resumeTenant,
	rotateTenantKeys,
	suspendTenant,
} from "./lifecycle.ts";
import { apiContainerName, isValidSlug } from "./names.ts";
import { type PlanId, isValidPlanId } from "./plans.ts";
import { provisionTenant } from "./provision.ts";
import { measureStorageMb } from "./storage.ts";
import { teardownTenant } from "./teardown.ts";
import { httpStatusForProvisionError, isProvisionError } from "./types.ts";

function isValidRotateType(v: unknown): v is KeyRotateType {
	return v === "service" || v === "anon" || v === "both";
}

function requireSecret(): MiddlewareHandler {
	const { secret } = getConfig();
	return async (c, next) => {
		// `/internal/*` routes are in-cluster only (no public port binding) and
		// must skip auth — e.g. Caddy's on-demand TLS ask endpoint.
		if (c.req.path.startsWith("/internal/")) return next();
		const provided = c.req.header("x-provisioner-secret");
		if (!provided || provided !== secret) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		return next();
	};
}

export function buildRoutes(): Hono {
	const app = new Hono();

	// Caddy on-demand TLS `ask` endpoint — unauth, only reachable inside the
	// compose network. Caddy calls this before issuing a cert for a new
	// `{slug}.{base}` subdomain (wildcard site block). Returns 200 if the
	// subject is the platform API or an existing tenant, 404 otherwise.
	app.get("/internal/caddy/ask", async (c) => {
		const domain = c.req.query("domain") ?? "";
		const { tenantBaseDomain } = getConfig();
		const suffix = `.${tenantBaseDomain}`;
		if (!domain.endsWith(suffix)) return c.text("wrong domain", 404);
		const label = domain.slice(0, -suffix.length);
		// Platform API is explicitly allowed (it has its own site block, but
		// Caddy may still consult ask for hostnames that match the wildcard).
		if (label === "api") return c.text("ok", 200);
		if (!isValidSlug(label)) return c.text("invalid slug", 404);
		const info = await containerInspect(apiContainerName(label));
		if (!info) return c.text("unknown tenant", 404);
		return c.text("ok", 200);
	});

	app.use("*", requireSecret());

	// POST /tenants — provision a new tenant.
	app.post("/tenants", async (c) => {
		const body = (await c.req.json().catch(() => null)) as {
			accountId?: unknown;
			plan?: unknown;
		} | null;
		if (!body || typeof body.accountId !== "string") {
			return c.json({ error: "accountId is required" }, 400);
		}
		if (typeof body.plan !== "string" || !isValidPlanId(body.plan)) {
			return c.json(
				{ error: "plan must be one of: launch, grow, scale, enterprise" },
				400,
			);
		}

		try {
			const tenant = await provisionTenant({
				accountId: body.accountId,
				plan: body.plan,
			});
			return c.json(tenant, 201);
		} catch (err) {
			if (isProvisionError(err)) {
				return c.json(
					{
						error: err.message,
						code: err.code,
						stage: err.stage,
						slug: err.slug,
						cleanupAttempted: err.cleanupAttempted,
					},
					httpStatusForProvisionError(err.code),
				);
			}
			throw err;
		}
	});

	// GET /tenants/:slug — live status + resource usage.
	// Caller passes `storageLimitMb` via query (from tenants row — already
	// folds in active add-ons). `plan` is carried as a label.
	app.get("/tenants/:slug", async (c) => {
		const slug = c.req.param("slug");
		if (!isValidSlug(slug)) return c.json({ error: "invalid slug" }, 400);
		const plan = (c.req.query("plan") ?? "launch") as PlanId;
		if (!isValidPlanId(plan)) return c.json({ error: "invalid plan" }, 400);
		const storageLimitMb = Number(c.req.query("storageLimitMb") ?? -1);
		const status = await getTenantStatus(slug, plan, storageLimitMb);
		return c.json(status);
	});

	// DELETE /tenants/:slug?deleteVolume=true|false — teardown.
	app.delete("/tenants/:slug", async (c) => {
		const slug = c.req.param("slug");
		if (!isValidSlug(slug)) return c.json({ error: "invalid slug" }, 400);
		const deleteVolume = c.req.query("deleteVolume") === "true";
		await teardownTenant(slug, { deleteVolume });
		return c.json({ slug, deleteVolume });
	});

	// POST /tenants/:slug/suspend — stop all containers, keep volume.
	app.post("/tenants/:slug/suspend", async (c) => {
		const slug = c.req.param("slug");
		if (!isValidSlug(slug)) return c.json({ error: "invalid slug" }, 400);
		await suspendTenant(slug);
		return c.json({ slug, status: "suspended" });
	});

	// POST /tenants/:slug/resume — start all containers.
	app.post("/tenants/:slug/resume", async (c) => {
		const slug = c.req.param("slug");
		if (!isValidSlug(slug)) return c.json({ error: "invalid slug" }, 400);
		await resumeTenant(slug);
		return c.json({ slug, status: "resumed" });
	});

	// POST /tenants/:slug/keys/rotate — mint new JWT(s) with bumped gen.
	// Platform API owns the gen counters; passes newServiceGen + newAnonGen
	// post-bump. Provisioner recreates the API container w/ new env + mints.
	app.post("/tenants/:slug/keys/rotate", async (c) => {
		const slug = c.req.param("slug");
		if (!isValidSlug(slug)) return c.json({ error: "invalid slug" }, 400);
		const body = (await c.req.json().catch(() => null)) as {
			type?: unknown;
			plan?: unknown;
			newServiceGen?: unknown;
			newAnonGen?: unknown;
		} | null;
		if (!body) return c.json({ error: "body required" }, 400);
		if (!isValidRotateType(body.type)) {
			return c.json({ error: "type must be one of: service, anon, both" }, 400);
		}
		if (typeof body.plan !== "string" || !isValidPlanId(body.plan)) {
			return c.json({ error: "plan required" }, 400);
		}
		if (
			typeof body.newServiceGen !== "number" ||
			typeof body.newAnonGen !== "number"
		) {
			return c.json(
				{ error: "newServiceGen + newAnonGen required (numbers)" },
				400,
			);
		}
		const result = await rotateTenantKeys(slug, body.plan, body.type, {
			serviceGen: body.newServiceGen,
			anonGen: body.newAnonGen,
		});
		return c.json(result);
	});

	// POST /tenants/:slug/resize — recreate with an explicit compute envelope.
	// Body: { plan, totalCpus, totalMemoryMb, storageLimitMb }.
	// `plan` is a label; sizing comes from `totalCpus`/`totalMemoryMb` so the
	// platform API can fold in `tenant_compute_addons` before calling.
	app.post("/tenants/:slug/resize", async (c) => {
		const slug = c.req.param("slug");
		if (!isValidSlug(slug)) return c.json({ error: "invalid slug" }, 400);
		const body = (await c.req.json().catch(() => null)) as {
			plan?: unknown;
			totalCpus?: unknown;
			totalMemoryMb?: unknown;
			storageLimitMb?: unknown;
		} | null;
		if (!body || typeof body.plan !== "string" || !isValidPlanId(body.plan)) {
			return c.json({ error: "plan is required" }, 400);
		}
		if (
			typeof body.totalCpus !== "number" ||
			typeof body.totalMemoryMb !== "number" ||
			typeof body.storageLimitMb !== "number"
		) {
			return c.json(
				{
					error:
						"totalCpus, totalMemoryMb, and storageLimitMb are required (numbers)",
				},
				400,
			);
		}
		await resizeTenant(slug, {
			plan: body.plan,
			totalCpus: body.totalCpus,
			totalMemoryMb: body.totalMemoryMb,
			storageLimitMb: body.storageLimitMb,
		});
		return c.json({ slug, plan: body.plan });
	});

	// POST /tenants/:slug/bastion — add or rotate the tenant's SSH pubkey on
	// the bastion. Idempotent: rerunning with a different pubkey rotates.
	app.post("/tenants/:slug/bastion", async (c) => {
		const slug = c.req.param("slug");
		if (!isValidSlug(slug)) return c.json({ error: "invalid slug" }, 400);
		const body = (await c.req.json().catch(() => null)) as {
			publicKey?: unknown;
		} | null;
		if (!body || typeof body.publicKey !== "string") {
			return c.json({ error: "publicKey required" }, 400);
		}
		try {
			await addBastionUser(slug, body.publicKey);
			return c.json({ slug, user: `tenant-${slug}` });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return c.json({ error: msg }, 400);
		}
	});

	// DELETE /tenants/:slug/bastion — remove the tenant's bastion user.
	app.delete("/tenants/:slug/bastion", async (c) => {
		const slug = c.req.param("slug");
		if (!isValidSlug(slug)) return c.json({ error: "invalid slug" }, 400);
		await removeBastionUser(slug);
		return c.json({ slug, removed: true });
	});

	// GET /tenants/:slug/storage — pg_database_size in MB. Caller passes the
	// tenant DB URL it stored at provision time (we're stateless).
	app.get("/tenants/:slug/storage", async (c) => {
		const slug = c.req.param("slug");
		if (!isValidSlug(slug)) return c.json({ error: "invalid slug" }, 400);
		const url = c.req.query("url");
		if (!url) {
			return c.json({ error: "url query param is required" }, 400);
		}
		const sizeMb = await measureStorageMb(url);
		return c.json({ slug, sizeMb });
	});

	return app;
}
