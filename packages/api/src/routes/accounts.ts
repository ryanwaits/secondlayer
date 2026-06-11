import { getCaps } from "@secondlayer/platform/db/queries/account-spend-caps";
import {
	getAccountById,
	isSlugTaken,
	updateAccountProfile,
} from "@secondlayer/platform/db/queries/accounts";
import { getProductUsage } from "@secondlayer/platform/db/queries/usage";
import {
	getBasePriceCents,
	getPlanDisplayName,
} from "@secondlayer/platform/pricing";
import { UpdateProfileRequestSchema } from "@secondlayer/platform/schemas/accounts";
import { getDb } from "@secondlayer/shared/db";
import { AuthenticationError } from "@secondlayer/shared/errors";
import { type Context, Hono } from "hono";
import { accountPlanToProductTier } from "../auth/product-token-store.ts";
import { INDEX_TIER_CONFIG } from "../index/tiers.ts";
import { STREAMS_TIER_CONFIG } from "../streams/tiers.ts";

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
		slug: account.slug,
		avatarUrl: account.avatar_url,
		createdAt: account.created_at.toISOString(),
	});
});

// ── /usage — plan + spend model ──────────────────────────────────
//
// Per-tenant compute/storage rollups died with dedicated provisioning
// (the tenants table is dormant); usage that exists today is plan price
// plus the monthly spend cap. Product read counts live on /usage/products.

app.get("/usage", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();
	const account = await getAccountById(db, accountId);
	if (!account) throw new AuthenticationError("Account not found");

	const now = new Date();
	const periodStart = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
	);
	const periodEnd = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999),
	);
	const msPerDay = 24 * 60 * 60 * 1000;
	const daysInPeriod = Math.round(
		(periodEnd.getTime() - periodStart.getTime() + 1) / msPerDay,
	);
	const daysElapsed = Math.max(
		1,
		Math.floor((now.getTime() - periodStart.getTime()) / msPerDay) + 1,
	);
	const daysRemaining = Math.max(0, daysInPeriod - daysElapsed);

	const plan = account.plan;

	const caps = await getCaps(db, accountId);

	const basePriceCents = getBasePriceCents(plan);
	const currentCents = basePriceCents;

	// Project EOM spend. Clamp day 1-2 (tiny denominator → false positives).
	const projectedCents =
		daysElapsed >= 3
			? Math.max(
					currentCents,
					Math.round(currentCents * (daysInPeriod / daysElapsed)),
				)
			: currentCents;

	const capCents = caps?.monthly_cap_cents ?? null;
	const thresholdPct = caps?.alert_threshold_pct ?? 80;
	const thresholdHit =
		capCents != null &&
		daysElapsed >= 3 &&
		projectedCents >= (capCents * thresholdPct) / 100;
	const frozen = caps?.frozen_at != null;

	return c.json({
		period: {
			startIso: periodStart.toISOString(),
			endIso: periodEnd.toISOString(),
			daysRemaining,
			daysElapsed,
		},
		plan: {
			tier: plan,
			name: getPlanDisplayName(plan),
			basePriceUsd: basePriceCents / 100,
		},
		spend: {
			currentCents,
			projectedCents,
			capCents,
			thresholdPct,
			thresholdHit,
			frozen,
		},
	});
});

// ── /usage/products — Streams + Index event counts ───────────────
//
// Tier limits are read from the enforcing configs so this display
// surface can never drift from what the rate limiter actually does.

app.get("/usage/products", async (c) => {
	const accountId = requireAccountId(c);
	const db = getDb();
	const account = await getAccountById(db, accountId);
	if (!account) throw new AuthenticationError("Account not found");

	const tier = accountPlanToProductTier(account.plan);
	const usage = await getProductUsage(db, accountId);

	return c.json({
		streams: {
			tier,
			rateLimitPerSecond: STREAMS_TIER_CONFIG[tier].rateLimitPerSecond,
			retentionDays: STREAMS_TIER_CONFIG[tier].retentionDays,
			eventsToday: usage.streamsEventsToday,
			eventsThisMonth: usage.streamsEventsThisMonth,
		},
		index: {
			tier,
			rateLimitPerSecond: INDEX_TIER_CONFIG[tier].rateLimitPerSecond,
			decodedEventsToday: usage.indexDecodedEventsToday,
			decodedEventsThisMonth: usage.indexDecodedEventsThisMonth,
		},
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

	const data = parsed.data;

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
