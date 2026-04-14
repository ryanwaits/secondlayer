import { getDb } from "@secondlayer/shared/db";
import { type Context, Hono } from "hono";

const app = new Hono();

function requireAccountId(c: Context): string {
	const accountId = c.get("accountId") as string | undefined;
	if (!accountId) {
		throw new Error("Not authenticated");
	}
	return accountId;
}

// List recent chat sessions
app.get("/", async (c) => {
	const accountId = requireAccountId(c);
	const limit = Number(c.req.query("limit") ?? "10");
	const db = getDb();

	const sessions = await db
		.selectFrom("chat_sessions")
		.select(["id", "title", "summary", "created_at", "updated_at"])
		.where("account_id", "=", accountId)
		.orderBy("created_at", "desc")
		.limit(limit)
		.execute();

	return c.json({ sessions });
});

// Create chat session (idempotent — skips if already exists)
app.post("/", async (c) => {
	const accountId = requireAccountId(c);
	const body = await c.req.json();
	const { id, title } = body;
	const db = getDb();

	// Upsert — don't fail if session already exists
	const existing = await db
		.selectFrom("chat_sessions")
		.select("id")
		.where("id", "=", id)
		.where("account_id", "=", accountId)
		.executeTakeFirst();

	if (existing) {
		return c.json({ id: existing.id });
	}

	const session = await db
		.insertInto("chat_sessions")
		.values({
			id,
			account_id: accountId,
			title: title ?? null,
		})
		.returning("id")
		.executeTakeFirstOrThrow();

	return c.json({ id: session.id }, 201);
});

// Update chat session (title, summary) — upserts if session doesn't exist yet
app.patch("/:id", async (c) => {
	const accountId = requireAccountId(c);
	const id = c.req.param("id");
	const body = await c.req.json();
	const db = getDb();

	const existing = await db
		.selectFrom("chat_sessions")
		.select("id")
		.where("id", "=", id)
		.where("account_id", "=", accountId)
		.executeTakeFirst();

	if (existing) {
		const updates: Record<string, unknown> = { updated_at: new Date() };
		if (body.title !== undefined) updates.title = body.title;
		if (body.summary !== undefined) updates.summary = body.summary;

		await db
			.updateTable("chat_sessions")
			.set(updates)
			.where("id", "=", id)
			.execute();
	} else {
		await db
			.insertInto("chat_sessions")
			.values({
				id,
				account_id: accountId,
				title: body.title ?? null,
			})
			.execute();
	}

	return c.json({ ok: true });
});

// Delete chat session (cascades to messages via FK)
app.delete("/:id", async (c) => {
	const accountId = requireAccountId(c);
	const id = c.req.param("id");
	const db = getDb();

	await db
		.deleteFrom("chat_sessions")
		.where("id", "=", id)
		.where("account_id", "=", accountId)
		.execute();

	return c.json({ ok: true });
});

// Get messages for a chat session
app.get("/:id/messages", async (c) => {
	const accountId = requireAccountId(c);
	const id = c.req.param("id");
	const db = getDb();

	// Verify ownership
	const session = await db
		.selectFrom("chat_sessions")
		.select("id")
		.where("id", "=", id)
		.where("account_id", "=", accountId)
		.executeTakeFirst();

	if (!session) {
		return c.json({ messages: [] });
	}

	const messages = await db
		.selectFrom("chat_messages")
		.select(["id", "role", "parts", "metadata", "created_at"])
		.where("chat_session_id", "=", id)
		.orderBy("created_at", "asc")
		.execute();

	return c.json({ messages });
});

// Save messages for a chat session (replace all)
app.put("/:id/messages", async (c) => {
	const accountId = requireAccountId(c);
	const id = c.req.param("id");
	const body = await c.req.json();
	const messages = body.messages as Array<{
		role: string;
		parts: unknown;
		metadata?: unknown;
	}>;
	const db = getDb();

	// Verify ownership
	const session = await db
		.selectFrom("chat_sessions")
		.select("id")
		.where("id", "=", id)
		.where("account_id", "=", accountId)
		.executeTakeFirst();

	if (!session) {
		return c.json({ error: "Session not found" }, 404);
	}

	// Replace all messages — delete existing, insert new
	await db.transaction().execute(async (tx) => {
		await tx
			.deleteFrom("chat_messages")
			.where("chat_session_id", "=", id)
			.execute();

		if (messages.length > 0) {
			await tx
				.insertInto("chat_messages")
				.values(
					messages.map((m) => ({
						chat_session_id: id,
						role: m.role,
						parts: m.parts,
						metadata: m.metadata ?? null,
					})),
				)
				.execute();
		}
	});

	return c.json({ ok: true });
});

export default app;
