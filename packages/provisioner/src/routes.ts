/**
 * Provisioner HTTP API. Mounted by `index.ts`. All routes gated by the
 * shared `PROVISIONER_SECRET` sent in `X-Provisioner-Secret` — this is the
 * only trust boundary between control plane and provisioner.
 *
 * Exception: `/internal/caddy/ask` is unauth — it's called by the in-cluster
 * Caddy reverse proxy to validate on-demand TLS cert requests.
 */

import { Hono, type MiddlewareHandler } from "hono";
import { getConfig } from "./config.ts";
import { containerInspect } from "./docker.ts";
import {
	getTenantStatus,
	resizeTenant,
	resumeTenant,
	suspendTenant,
} from "./lifecycle.ts";
import { apiContainerName, isValidSlug } from "./names.ts";
import { type PlanId, isValidPlanId } from "./plans.ts";
import { provisionTenant } from "./provision.ts";
import { measureStorageMb } from "./storage.ts";
import { teardownTenant } from "./teardown.ts";
import { isProvisionError } from "./types.ts";

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
						stage: err.stage,
						slug: err.slug,
						cleanupAttempted: err.cleanupAttempted,
					},
					500,
				);
			}
			throw err;
		}
	});

	// GET /tenants/:slug — live status + resource usage.
	app.get("/tenants/:slug", async (c) => {
		const slug = c.req.param("slug");
		if (!isValidSlug(slug)) return c.json({ error: "invalid slug" }, 400);
		const plan = (c.req.query("plan") ?? "launch") as PlanId;
		if (!isValidPlanId(plan)) return c.json({ error: "invalid plan" }, 400);
		const status = await getTenantStatus(slug, plan);
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

	// POST /tenants/:slug/resize — recreate with new plan's limits.
	app.post("/tenants/:slug/resize", async (c) => {
		const slug = c.req.param("slug");
		if (!isValidSlug(slug)) return c.json({ error: "invalid slug" }, 400);
		const body = (await c.req.json().catch(() => null)) as {
			newPlan?: unknown;
		} | null;
		if (
			!body ||
			typeof body.newPlan !== "string" ||
			!isValidPlanId(body.newPlan)
		) {
			return c.json({ error: "newPlan is required" }, 400);
		}
		await resizeTenant(slug, body.newPlan);
		return c.json({ slug, plan: body.newPlan });
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
