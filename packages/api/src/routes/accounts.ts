import { getDb } from "@secondlayer/shared/db";
import {
	getAccountById,
	isSlugTaken,
	updateAccountProfile,
} from "@secondlayer/shared/db/queries/accounts";
import {
	checkLimits,
	getDailyUsage,
} from "@secondlayer/shared/db/queries/usage";
import { AuthenticationError } from "@secondlayer/shared/errors";
import { UpdateProfileRequestSchema } from "@secondlayer/shared/schemas/marketplace";
import { type Context, Hono } from "hono";

const app = new Hono();

function requireAccountId(c: Context): string {
	const accountId = c.get("accountId") as string | undefined;
	if (!accountId) throw new AuthenticationError("Not authenticated");
	return accountId;
}

// GET /api/accounts/me
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
		slug: account.slug,
		avatarUrl: account.avatar_url,
		createdAt: account.created_at.toISOString(),
	});
});

// GET /api/accounts/usage
app.get("/usage", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();
	const account = await getAccountById(db, accountId);
	if (!account) throw new AuthenticationError("Account not found");

	const [result, daily] = await Promise.all([
		checkLimits(db, accountId, account.plan),
		getDailyUsage(db, accountId),
	]);

	return c.json({
		plan: account.plan,
		limits: result.limits,
		current: {
			subgraphs: result.current.subgraphs,
			apiRequestsToday: result.current.apiRequestsToday,
			deliveriesThisMonth: result.current.deliveriesThisMonth,
			storageBytes: result.current.storageBytes,
		},
		daily,
	});
});

// PATCH /api/accounts/me — update profile (display_name, bio, slug)
app.patch("/me", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();

	const body = await c.req.json();
	const parsed = UpdateProfileRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: parsed.error.issues }, 400);
	}

	const data = parsed.data;

	// Check slug uniqueness if changing
	if (data.slug) {
		const taken = await isSlugTaken(db, data.slug, accountId);
		if (taken) {
			return c.json({ error: "Slug already taken" }, 409);
		}
	}

	const updated = await updateAccountProfile(db, accountId, data);

	return c.json({
		id: updated.id,
		email: updated.email,
		displayName: updated.display_name,
		bio: updated.bio,
		slug: updated.slug,
		avatarUrl: updated.avatar_url,
	});
});

export default app;
