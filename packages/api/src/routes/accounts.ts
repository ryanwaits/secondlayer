import { getDb } from "@secondlayer/shared/db";
import { getCaps } from "@secondlayer/shared/db/queries/account-spend-caps";
import {
	getComputeUsage,
	getProjectBreakdown,
	getStorageUsage,
} from "@secondlayer/shared/db/queries/account-usage";
import {
	getAccountById,
	isSlugTaken,
	updateAccountProfile,
} from "@secondlayer/shared/db/queries/accounts";
import { AuthenticationError } from "@secondlayer/shared/errors";
import {
	getBasePriceCents,
	getPlanDisplayName,
	hasStorageOverage,
} from "@secondlayer/shared/pricing";
import { UpdateProfileRequestSchema } from "@secondlayer/shared/schemas/accounts";
import { type Context, Hono } from "hono";
import { emitMeterEvent } from "../lib/stripe-meter.ts";

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

// ── /usage — compute/storage usage model ─────────────────────────

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

	const [compute, storage, projects, caps] = await Promise.all([
		getComputeUsage(db, accountId, plan, periodStart, now),
		getStorageUsage(db, accountId, plan, now),
		getProjectBreakdown(db, accountId, plan, periodStart, now),
		getCaps(db, accountId),
	]);

	// Crude spend approximation — matches what Stripe metering will bill.
	// Compute overage: $0.015/hr (1.5¢). Storage overage: $2/GB (200¢/GB).
	// Hobby has hard caps so overage is always 0.
	const computeOverageHours = Math.max(
		0,
		compute.usedHours - compute.allowanceHours,
	);
	const storageOverageBytes = Math.max(
		0,
		storage.usedBytes - storage.allowanceBytes,
	);
	const bytesPerGb = 1024 ** 3;
	const computeOverageCents = Math.round(computeOverageHours * 1.5);
	const storageOverageCents = hasStorageOverage(plan)
		? Math.round((storageOverageBytes / bytesPerGb) * 200)
		: 0;
	const basePriceCents = getBasePriceCents(plan);
	const currentCents =
		basePriceCents + computeOverageCents + storageOverageCents;

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
		compute,
		storage,
		projects,
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

// ── POST /me/meter — emit a Stripe billing meter event ───────────
//
// Called by user-facing surfaces (the AI session chat + title routes)
// to record usage that gets billed via overage prices. Fire-and-forget
// from the caller's perspective: this endpoint always returns 204 even
// when Stripe is unconfigured or the account has no customer record
// (Hobby tenants who never upgraded — they accrue zero charges, the
// meter call is a no-op).

const ALLOWED_METER_EVENTS = new Set(["ai_evals", "storage_gb_months"]);

// Per-call ceiling on metered values. Defensive — even though the caller
// can only inflate their *own* bill, capping protects against bugs in
// upstream emitters and against direct curl shenanigans (the endpoint is
// reachable to any authenticated session; the chat/title routes are the
// only intended callers but the surface is open).
//
// Anthropic's largest current model context is ~200k tokens, so 1M is
// 5× headroom for input+output combined. Storage GB-months realistically
// stays well under this for any single emission.
const METER_VALUE_MAX = 1_000_000;

app.post("/me/meter", async (c) => {
	const accountId = requireAccountId(c);
	const body = (await c.req.json().catch(() => ({}))) as {
		eventName?: unknown;
		value?: unknown;
	};
	if (
		typeof body.eventName !== "string" ||
		!ALLOWED_METER_EVENTS.has(body.eventName) ||
		typeof body.value !== "number" ||
		!Number.isFinite(body.value) ||
		body.value < 0 ||
		body.value > METER_VALUE_MAX
	) {
		return c.json(
			{
				error: "invalid eventName or value (value must be 0..1_000_000)",
			},
			400,
		);
	}
	await emitMeterEvent(
		accountId,
		body.eventName as "ai_evals" | "storage_gb_months",
		body.value,
	);
	return c.body(null, 204);
});

export default app;
