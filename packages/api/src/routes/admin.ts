import { sendApprovalNotification } from "@secondlayer/auth/email";
import { getDb } from "@secondlayer/shared/db";
import {
	approveWaitlistEntry,
	getWaitlistById,
	listWaitlist,
} from "@secondlayer/shared/db/queries/accounts";
import { Hono } from "hono";
import { sql } from "kysely";

const app = new Hono();

// GET /api/admin/waitlist?status=pending
app.get("/waitlist", async (c) => {
	const db = getDb();
	const status = c.req.query("status") || undefined;
	const entries = await listWaitlist(db, status);
	return c.json({
		entries: entries.map((e) => ({
			id: e.id,
			email: e.email,
			source: e.source,
			status: e.status,
			createdAt: e.created_at.toISOString(),
		})),
	});
});

// POST /api/admin/waitlist/:id/approve
app.post("/waitlist/:id/approve", async (c) => {
	const db = getDb();
	const entry = await getWaitlistById(db, c.req.param("id"));
	if (!entry) return c.json({ error: "Waitlist entry not found" }, 404);

	const result = await approveWaitlistEntry(db, entry.email);
	if (result.status === "already_approved") {
		return c.json({ error: "Already approved" }, 409);
	}

	await sendApprovalNotification(entry.email, result.token);
	return c.json({ message: `Approved ${entry.email}` });
});

// POST /api/admin/waitlist/bulk-approve
app.post("/waitlist/bulk-approve", async (c) => {
	const { ids } = await c.req.json<{ ids: string[] }>();
	const db = getDb();
	const results: { email: string; status: string }[] = [];

	for (const id of ids) {
		const entry = await getWaitlistById(db, id);
		if (!entry) {
			results.push({ email: id, status: "not_found" });
			continue;
		}
		const result = await approveWaitlistEntry(db, entry.email);
		if (result.status === "approved") {
			await sendApprovalNotification(entry.email, result.token);
		}
		results.push({ email: entry.email, status: result.status });
	}

	return c.json({ results });
});

// GET /api/admin/accounts
app.get("/accounts", async (c) => {
	const db = getDb();
	const accounts = await sql<{
		id: string;
		email: string;
		plan: string;
		created_at: Date;
		subgraph_count: string;
		last_active: Date | null;
	}>`
		SELECT a.*,
			(SELECT count(*) FROM subgraphs WHERE account_id = a.id) AS subgraph_count,
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
			subgraphCount: Number(a.subgraph_count),
			lastActive: a.last_active ? a.last_active.toISOString() : null,
		})),
	});
});

// GET /api/admin/stats
app.get("/stats", async (c) => {
	const db = getDb();
	const [accounts, waitlist, subgraphs] = await Promise.all([
		db
			.selectFrom("accounts")
			.select((eb) => eb.fn.countAll<number>().as("count"))
			.executeTakeFirstOrThrow(),
		db
			.selectFrom("waitlist")
			.select((eb) => eb.fn.countAll<number>().as("count"))
			.where("status", "=", "pending")
			.executeTakeFirstOrThrow(),
		db
			.selectFrom("subgraphs")
			.select((eb) => [
				eb.fn.countAll<number>().as("total"),
				eb.fn
					.count<number>("id")
					.filterWhere("status", "=", "active")
					.as("active"),
				eb.fn
					.count<number>("id")
					.filterWhere("status", "=", "error")
					.as("error"),
			])
			.executeTakeFirstOrThrow(),
	]);

	return c.json({
		totalAccounts: Number(accounts.count),
		pendingWaitlist: Number(waitlist.count),
		totalSubgraphs: Number(subgraphs.total),
		activeSubgraphs: Number(subgraphs.active),
		errorSubgraphs: Number(subgraphs.error),
	});
});

export default app;
