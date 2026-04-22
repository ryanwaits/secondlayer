import crypto from "node:crypto";
import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import {
	getProjectBySlug,
	getProjectsByAccount,
	getTeamInvitations,
	getTeamMembers,
} from "@secondlayer/shared/db/queries/projects";
import {
	getTenantByAccount,
	insertTenant,
} from "@secondlayer/shared/db/queries/tenants";
import { AuthenticationError } from "@secondlayer/shared/errors";
import { type Context, Hono } from "hono";
import {
	ProvisionerError,
	provisionTenant as provisionerProvision,
} from "../lib/provisioner-client.ts";
import { InvalidJSONError } from "../middleware/error.ts";

const app = new Hono();

function requireAccountId(c: Context): string {
	const accountId = c.get("accountId") as string | undefined;
	if (!accountId) throw new AuthenticationError("Not authenticated");
	return accountId;
}

// GET /api/projects — list projects for account
app.get("/", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();
	const projects = await getProjectsByAccount(db, accountId);
	return c.json({
		projects: projects.map((p) => ({
			id: p.id,
			name: p.name,
			slug: p.slug,
			network: p.network,
			nodeRpc: p.node_rpc,
			settings: p.settings,
			createdAt: p.created_at.toISOString(),
			updatedAt: p.updated_at.toISOString(),
		})),
	});
});

// GET /api/projects/:slug — get project detail
app.get("/:slug", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();
	const slug = c.req.param("slug");
	const project = await getProjectBySlug(db, accountId, slug);
	if (!project) return c.json({ error: "Project not found" }, 404);
	return c.json({
		id: project.id,
		name: project.name,
		slug: project.slug,
		network: project.network,
		nodeRpc: project.node_rpc,
		settings: project.settings,
		createdAt: project.created_at.toISOString(),
		updatedAt: project.updated_at.toISOString(),
	});
});

// POST /api/projects — create project
app.post("/", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();
	const body = await c.req.json();
	const { name, slug, network, nodeRpc } = body;

	if (!name || !slug) return c.json({ error: "name and slug required" }, 400);

	const existing = await getProjectBySlug(db, accountId, slug);
	if (existing) return c.json({ error: "Slug already exists" }, 409);

	const project = await db
		.insertInto("projects")
		.values({
			name,
			slug,
			account_id: accountId,
			network: network || "mainnet",
			node_rpc: nodeRpc || null,
		})
		.returningAll()
		.executeTakeFirstOrThrow();

	// Add creator as owner
	await db
		.insertInto("team_members")
		.values({
			project_id: project.id,
			account_id: accountId,
			role: "owner",
		})
		.execute();

	return c.json(
		{
			id: project.id,
			name: project.name,
			slug: project.slug,
			network: project.network,
			nodeRpc: project.node_rpc,
			createdAt: project.created_at.toISOString(),
		},
		201,
	);
});

// PATCH /api/projects/:slug — update project
app.patch("/:slug", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();
	const slug = c.req.param("slug");
	const project = await getProjectBySlug(db, accountId, slug);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const body = await c.req.json();
	const updates: Record<string, unknown> = {};
	if (body.name !== undefined) updates.name = body.name;
	if (body.slug !== undefined) {
		if (body.slug !== project.slug) {
			const taken = await getProjectBySlug(db, accountId, body.slug);
			if (taken) return c.json({ error: "Slug already exists" }, 409);
		}
		updates.slug = body.slug;
	}
	if (body.network !== undefined) updates.network = body.network;
	if (body.nodeRpc !== undefined) updates.node_rpc = body.nodeRpc;
	if (body.settings !== undefined)
		updates.settings = JSON.stringify(body.settings);

	if (Object.keys(updates).length === 0) {
		return c.json({ error: "No fields to update" }, 400);
	}

	updates.updated_at = new Date();

	const updated = await db
		.updateTable("projects")
		.set(updates)
		.where("id", "=", project.id)
		.returningAll()
		.executeTakeFirstOrThrow();

	return c.json({
		id: updated.id,
		name: updated.name,
		slug: updated.slug,
		network: updated.network,
		nodeRpc: updated.node_rpc,
		settings: updated.settings,
		updatedAt: updated.updated_at.toISOString(),
	});
});

// DELETE /api/projects/:slug — delete project
app.delete("/:slug", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();
	const slug = c.req.param("slug");
	const project = await getProjectBySlug(db, accountId, slug);
	if (!project) return c.json({ error: "Project not found" }, 404);

	// Check not the only project
	const all = await getProjectsByAccount(db, accountId);
	if (all.length <= 1) {
		return c.json({ error: "Cannot delete your only project" }, 400);
	}

	await db.deleteFrom("projects").where("id", "=", project.id).execute();
	return c.json({ ok: true });
});

// GET /api/projects/:slug/team — list members + pending invitations
app.get("/:slug/team", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();
	const slug = c.req.param("slug");
	const project = await getProjectBySlug(db, accountId, slug);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const [members, invitations] = await Promise.all([
		getTeamMembers(db, project.id),
		getTeamInvitations(db, project.id),
	]);

	return c.json({
		members: members.map((m) => ({
			id: m.id,
			role: m.role,
			email: m.email,
			displayName: m.display_name,
			avatarUrl: m.avatar_url,
			createdAt: m.created_at.toISOString(),
		})),
		invitations: invitations.map((i) => ({
			id: i.id,
			email: i.email,
			role: i.role,
			expiresAt: i.expires_at.toISOString(),
			createdAt: i.created_at.toISOString(),
		})),
	});
});

// POST /api/projects/:slug/team/invite — invite member
app.post("/:slug/team/invite", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();
	const slug = c.req.param("slug");
	const project = await getProjectBySlug(db, accountId, slug);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const { email, role } = await c.req.json();
	if (!email) return c.json({ error: "email required" }, 400);

	const token = crypto.randomBytes(32).toString("hex");
	const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

	const invitation = await db
		.insertInto("team_invitations")
		.values({
			project_id: project.id,
			email,
			role: role || "member",
			token,
			invited_by: accountId,
			expires_at: expiresAt,
		})
		.returningAll()
		.executeTakeFirstOrThrow();

	return c.json(
		{
			id: invitation.id,
			email: invitation.email,
			role: invitation.role,
			expiresAt: invitation.expires_at.toISOString(),
		},
		201,
	);
});

// DELETE /api/projects/:slug/team/:memberId — remove member
app.delete("/:slug/team/:memberId", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();
	const slug = c.req.param("slug");
	const memberId = c.req.param("memberId");
	const project = await getProjectBySlug(db, accountId, slug);
	if (!project) return c.json({ error: "Project not found" }, 404);

	// Can't remove the owner
	const member = await db
		.selectFrom("team_members")
		.selectAll()
		.where("id", "=", memberId)
		.where("project_id", "=", project.id)
		.executeTakeFirst();

	if (!member) return c.json({ error: "Member not found" }, 404);
	if (member.role === "owner")
		return c.json({ error: "Cannot remove owner" }, 400);

	await db.deleteFrom("team_members").where("id", "=", memberId).execute();
	return c.json({ ok: true });
});

// PATCH /api/projects/:slug/team/:memberId — update role
app.patch("/:slug/team/:memberId", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();
	const slug = c.req.param("slug");
	const memberId = c.req.param("memberId");
	const project = await getProjectBySlug(db, accountId, slug);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const { role } = await c.req.json();
	if (!role || !["admin", "member"].includes(role)) {
		return c.json({ error: "Invalid role" }, 400);
	}

	await db
		.updateTable("team_members")
		.set({ role })
		.where("id", "=", memberId)
		.where("project_id", "=", project.id)
		.execute();

	return c.json({ ok: true });
});

// POST /api/projects/:slug/instance — provision a tenant bound to this project.
// Platform control plane manages the project_id → tenant linkage; provisioner
// creates Docker resources and is unaware of projects.
//
// Body: `{ plan: "launch" | "grow" | "scale" | "enterprise" }`.
// Returns: `{ tenant, credentials: { apiUrl, anonKey, serviceKey } }` — same
// shape as POST /api/tenants so the dashboard/CLI can share response handling.
//
// Enforces the 1:1 project↔tenant rule at application layer: 409 if the
// project already has a tenant.
app.post("/:slug/instance", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();
	const slug = c.req.param("slug");
	const project = await getProjectBySlug(db, accountId, slug);
	if (!project) return c.json({ error: "Project not found" }, 404);

	const body = (await c.req.json().catch(() => {
		throw new InvalidJSONError();
	})) as { plan?: unknown };
	if (
		typeof body.plan !== "string" ||
		!["launch", "grow", "scale", "enterprise"].includes(body.plan)
	) {
		return c.json(
			{ error: "plan must be one of: launch, grow, scale, enterprise" },
			400,
		);
	}
	const plan = body.plan as "launch" | "grow" | "scale" | "enterprise";

	// Enforce 1 project : 1 tenant today. The `project_id` FK is on
	// `tenants`, so walk there and reject if one already exists for this
	// account and this project.
	const existing = await getTenantByAccount(db, accountId);
	if (existing && existing.project_id === project.id) {
		return c.json(
			{
				error: "Project already has an instance",
				code: "INSTANCE_EXISTS",
				tenant: {
					slug: existing.slug,
					plan: existing.plan,
					status: existing.status,
					apiUrl: existing.api_url_public,
				},
			},
			409,
		);
	}

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

	const alloc = {
		launch: { cpus: 1, memoryMb: 2048, storageLimitMb: 10240 },
		grow: { cpus: 2, memoryMb: 4096, storageLimitMb: 51200 },
		scale: { cpus: 4, memoryMb: 8192, storageLimitMb: 204800 },
		enterprise: { cpus: 8, memoryMb: 32_768, storageLimitMb: -1 },
	}[plan];

	const tenant = await insertTenant(db, {
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
		projectId: project.id,
	});

	logger.info("Tenant provisioned for project", {
		slug: tenant.slug,
		projectSlug: project.slug,
		accountId,
	});

	return c.json(
		{
			tenant: {
				slug: tenant.slug,
				plan: tenant.plan,
				status: tenant.status,
				cpus: Number(tenant.cpus),
				memoryMb: tenant.memory_mb,
				storageLimitMb: tenant.storage_limit_mb,
				apiUrl: tenant.api_url_public,
				createdAt: tenant.created_at,
				projectId: tenant.project_id,
			},
			credentials: {
				apiUrl: provisioned.apiUrlPublic,
				anonKey: provisioned.anonKey,
				serviceKey: provisioned.serviceKey,
			},
		},
		201,
	);
});

export default app;
