import { getDb } from "@secondlayer/shared/db";
import { AuthenticationError } from "@secondlayer/shared/errors";
import { Hono } from "hono";

const app = new Hono();

function requireAccountId(c: any): string {
	const accountId = c.get("accountId") as string | undefined;
	if (!accountId) throw new AuthenticationError("Not authenticated");
	return accountId;
}

// GET /api/insights
app.get("/", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();

	const resourceId = c.req.query("resource_id");
	const category = c.req.query("category");

	let query = db
		.selectFrom("account_insights")
		.selectAll()
		.where("account_id", "=", accountId)
		.where("dismissed_at", "is", null)
		.where((eb) =>
			eb.or([eb("expires_at", "is", null), eb("expires_at", ">", new Date())]),
		)
		.orderBy("created_at", "desc");

	if (resourceId) {
		query = query.where("resource_id", "=", resourceId);
	}
	if (category) {
		query = query.where("category", "=", category);
	}

	const insights = await query.execute();

	return c.json({
		insights: insights.map((i) => ({
			id: i.id,
			category: i.category,
			insightType: i.insight_type,
			resourceId: i.resource_id,
			severity: i.severity,
			title: i.title,
			body: i.body,
			data: i.data,
			createdAt: i.created_at.toISOString(),
			expiresAt: i.expires_at?.toISOString() ?? null,
		})),
	});
});

// POST /api/insights/:id/dismiss
app.post("/:id/dismiss", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();
	const insightId = c.req.param("id");

	const result = await db
		.updateTable("account_insights")
		.set({ dismissed_at: new Date() })
		.where("id", "=", insightId)
		.where("account_id", "=", accountId)
		.executeTakeFirst();

	if (Number(result.numUpdatedRows) === 0) {
		return c.json({ error: "Insight not found" }, 404);
	}

	return c.json({ ok: true });
});

export default app;
