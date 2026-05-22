import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { sql } from "kysely";

const app = new Hono();

// GET /api/admin/accounts
app.get("/accounts", async (c) => {
	const db = getDb();
	const accounts = await sql<{
		id: string;
		email: string;
		plan: string;
		created_at: Date;
		tenant_count: string;
		last_active: Date | null;
	}>`
		SELECT a.*,
			(SELECT count(*) FROM tenants WHERE account_id = a.id AND status <> 'deleted') AS tenant_count,
			(SELECT max(last_used_at) FROM sessions WHERE account_id = a.id) AS last_active
		FROM accounts a
		ORDER BY a.created_at DESC
	`.execute(db);

	return c.json({
		accounts: accounts.rows.map((a) => ({
			id: a.id,
			email: a.email,
			plan: a.plan,
			createdAt: a.created_at.toISOString(),
			tenantCount: Number(a.tenant_count),
			lastActive: a.last_active ? a.last_active.toISOString() : null,
		})),
	});
});

// GET /api/admin/stats
app.get("/stats", async (c) => {
	const db = getDb();
	const [accounts, tenants] = await Promise.all([
		db
			.selectFrom("accounts")
			.select((eb) => eb.fn.countAll<number>().as("count"))
			.executeTakeFirstOrThrow(),
		db
			.selectFrom("tenants")
			.select((eb) => [
				eb.fn.countAll<number>().as("total"),
				eb.fn
					.count<number>("id")
					.filterWhere("status", "=", "active")
					.as("active"),
				eb.fn
					.count<number>("id")
					.filterWhere("status", "=", "suspended")
					.as("suspended"),
			])
			.executeTakeFirstOrThrow(),
	]);

	return c.json({
		totalAccounts: Number(accounts.count),
		totalTenants: Number(tenants.total),
		activeTenants: Number(tenants.active),
		suspendedTenants: Number(tenants.suspended),
	});
});

export default app;
