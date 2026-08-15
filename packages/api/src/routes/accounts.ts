import {
	getAccountById,
	updateAccountProfile,
} from "@secondlayer/platform/db/queries/accounts";
import { UpdateProfileRequestSchema } from "@secondlayer/platform/schemas/accounts";
import { getDb } from "@secondlayer/shared/db";
import { AuthenticationError } from "@secondlayer/shared/errors";
import { type Context, Hono } from "hono";

const app = new Hono();

function requireAccountId(c: Context): string {
	const accountId = c.get("accountId") as string | undefined;
	if (!accountId) throw new AuthenticationError("Not authenticated");
	return accountId;
}

// ── /me ──────────────────────────────────────────────────────────

app.get("/me", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();
	const account = await getAccountById(db, accountId);
	if (!account) throw new AuthenticationError("Account not found");

	return c.json({
		id: account.id,
		email: account.email,
		plan: account.plan,
		displayName: account.display_name,
		bio: account.bio,
		avatarUrl: account.avatar_url,
		notifyReindexComplete: account.notify_reindex_complete,
		createdAt: account.created_at.toISOString(),
	});
});

// ── /me (PATCH) ───────────────────────────────────────────────────

app.patch("/me", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();

	const body = await c.req.json();
	const parsed = UpdateProfileRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: parsed.error.issues }, 400);
	}

	const updated = await updateAccountProfile(db, accountId, parsed.data);

	return c.json({
		id: updated.id,
		email: updated.email,
		displayName: updated.display_name,
		bio: updated.bio,
		avatarUrl: updated.avatar_url,
		notifyReindexComplete: updated.notify_reindex_complete,
	});
});

export default app;
