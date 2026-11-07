import {
	getAccountById,
	updateAccountProfile,
} from "@secondlayer/platform/db/queries/accounts";
import { UpdateProfileRequestSchema } from "@secondlayer/platform/schemas/accounts";
import { getDb } from "@secondlayer/shared/db";
import { AuthenticationError } from "@secondlayer/shared/errors";
import { type Context, Hono } from "hono";
import { createInsightsRoutes } from "./insights.ts";

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
		displayName: account.display_name,
		bio: account.bio,
		avatarUrl: account.avatar_url,
		notifyReindexComplete: account.notify_reindex_complete,
		createdAt: account.created_at.toISOString(),
		// Analytics marks a first-party account's person as internal.
		internal: account.internal,
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

// ── /me/updates ──────────────────────────────────────────────────

// The account email's place on the updates list, so the signup form can
// step aside for a reader already on it. The token is the same one every
// update email carries in its unsubscribe link; the account proved it owns
// that inbox at sign-in.
app.get("/me/updates", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();
	const account = await getAccountById(db, accountId);
	if (!account) throw new AuthenticationError("Account not found");
	const email = account.email;
	if (!email) return c.json({ email: null, status: "none", token: null });

	const row = await db
		.selectFrom("update_subscribers")
		.select(["status", "token"])
		.where((eb) => eb(eb.fn("lower", ["email"]), "=", email.toLowerCase()))
		.executeTakeFirst();
	return c.json({
		email,
		status: row?.status ?? "none",
		token: row?.status === "confirmed" ? row.token : null,
	});
});

// ── /insights ─────────────────────────────────────────────────────

// Account-level insights (reads, billing), scoped to the signed-in account.
app.route(
	"/insights",
	createInsightsRoutes((c) => ({ accountId: requireAccountId(c) })),
);

export default app;
