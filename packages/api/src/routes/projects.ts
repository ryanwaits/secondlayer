import crypto from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import {
	getProjectBySlug,
	getProjectsByAccount,
	getTeamInvitations,
	getTeamMembers,
} from "@secondlayer/shared/db/queries/projects";
import { AuthenticationError } from "@secondlayer/shared/errors";
import { type Context, Hono } from "hono";

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

export default app;
