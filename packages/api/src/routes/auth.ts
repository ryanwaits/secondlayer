import {
	createMagicLink,
	upsertAccount,
	verifyMagicLink,
	verifyMagicLinkByCode,
} from "@secondlayer/platform/db/queries/accounts";
import { getDb } from "@secondlayer/shared/db";
import { ValidationError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { z } from "zod/v4";
import { sendMagicLink } from "../auth/email.ts";
import { consumeClaimToken, validateClaimToken } from "../auth/ghost.ts";
import { getClientIp } from "../auth/http.ts";
import { generateSessionToken, hashToken } from "../auth/keys.ts";
import { isDevMode } from "../lib/dev-mode.ts";
import { InvalidJSONError } from "../middleware/error.ts";

const app = new Hono();

const MagicLinkSchema = z.object({
	email: z.string().email(),
});

const VerifySchema = z.union([
	z.object({ token: z.string().min(1) }),
	z.object({ code: z.string().length(6), email: z.string().email() }),
]);

// IP-based rate limiting for verify endpoint
const verifyAttempts = new Map<string, { count: number; resetAt: number }>();
const VERIFY_RATE_LIMIT = 10;
const VERIFY_WINDOW_MS = 15 * 60_000;

function checkVerifyRateLimit(ip: string): boolean {
	const now = Date.now();
	const entry = verifyAttempts.get(ip);
	if (!entry || now > entry.resetAt) {
		verifyAttempts.set(ip, { count: 1, resetAt: now + VERIFY_WINDOW_MS });
		return true;
	}
	if (entry.count >= VERIFY_RATE_LIMIT) return false;
	entry.count++;
	return true;
}

// Request magic link (no auth)
app.post("/magic-link", async (c) => {
	const body = await c.req.json().catch(() => {
		throw new InvalidJSONError();
	});

	const parsed = MagicLinkSchema.parse(body);
	const db = getDb();

	// Generate secure magic link token (for URL)
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);

	// Generate 6-digit numeric code (for manual entry)
	const codeNum = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
	const code = String(codeNum).padStart(6, "0");

	await createMagicLink(db, parsed.email, token, code);
	await sendMagicLink(parsed.email, token, code);

	return c.json({
		message: "Check your email for a login code.",
		...(isDevMode() && { token, code }),
	});
});

// Verify token or code → create account + session token (no auth)
app.post("/verify", async (c) => {
	const ip = getClientIp(c);
	if (!checkVerifyRateLimit(ip)) {
		return c.json({ error: "Too many attempts. Try again later." }, 429);
	}

	const body = await c.req.json().catch(() => {
		throw new InvalidJSONError();
	});

	const parsed = VerifySchema.parse(body);
	const db = getDb();

	const email =
		"token" in parsed
			? await verifyMagicLink(db, parsed.token)
			: await verifyMagicLinkByCode(db, parsed.email, parsed.code);
	if (!email) {
		throw new ValidationError("Invalid or expired code");
	}

	const account = await upsertAccount(db, email);

	// Create session token
	const { raw, hash, prefix } = generateSessionToken();
	await db
		.insertInto("sessions")
		.values({
			token_hash: hash,
			token_prefix: prefix,
			account_id: account.id,
			ip_address: getClientIp(c),
		})
		.execute();

	return c.json({
		sessionToken: raw,
		account: {
			id: account.id,
			email: account.email,
			plan: account.plan,
		},
	});
});

const ClaimSchema = z.object({
	token: z.string().min(1),
	email: z.string().email(),
});

const ClaimVerifySchema = z.intersection(
	z.object({ token: z.string().min(1) }),
	z.union([
		z.object({ magic_token: z.string().min(1) }),
		z.object({ code: z.string().length(6), email: z.string().email() }),
	]),
);

// ── Ghost-account claim (magic-link email attach) ──────────────────────
//
// Two-phase, both keyed by the raw claim token from the mint-time claim URL:
//   1. POST /claim { token, email } — validates the claim token (read-only, not
//      burned) and sends a standard magic link to the email.
//   2. POST /claim/verify { token, code+email | magic_token } — verifies the
//      magic link (proves email ownership), atomically consumes the claim
//      token, then either attaches the email to the ghost account
//      (email new: set email, ghost=false) or merges the ghost into the
//      existing account for that email (moves api_keys, deletes the ghost).
//
// Seam note: `magic_links` has no metadata column, so the claim↔magic-link
// association is held client-side — the claim token is presented again at
// verify. This reuses createMagicLink/verifyMagicLink unmodified instead of
// threading claim state through the core auth tables. On merge, the ghost's
// usage_daily rows are cascade-dropped with the account (keys + their future
// usage survive under the existing account).

// Phase 1: validate claim token + send magic link (no auth)
app.post("/claim", async (c) => {
	const body = await c.req.json().catch(() => {
		throw new InvalidJSONError();
	});
	const parsed = ClaimSchema.parse(body);
	const db = getDb();

	const claim = await validateClaimToken(db, parsed.token);
	if (!claim) {
		throw new ValidationError("Invalid or expired claim token");
	}

	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
	const codeNum = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
	const code = String(codeNum).padStart(6, "0");

	await createMagicLink(db, parsed.email, token, code);
	await sendMagicLink(parsed.email, token, code);

	return c.json({
		message: "Check your email for a code to finish claiming this key.",
		...(isDevMode() && { token, code }),
	});
});

// Phase 2: verify magic link + execute the claim (no auth)
app.post("/claim/verify", async (c) => {
	const ip = getClientIp(c);
	if (!checkVerifyRateLimit(ip)) {
		return c.json({ error: "Too many attempts. Try again later." }, 429);
	}

	const body = await c.req.json().catch(() => {
		throw new InvalidJSONError();
	});
	const parsed = ClaimVerifySchema.parse(body);
	const db = getDb();

	const email =
		"magic_token" in parsed
			? await verifyMagicLink(db, parsed.magic_token)
			: await verifyMagicLinkByCode(db, parsed.email, parsed.code);
	if (!email) {
		throw new ValidationError("Invalid or expired code");
	}

	const account = await db.transaction().execute(async (trx) => {
		// Single-use: the UPDATE ... WHERE used_at IS NULL is the concurrency
		// guard. Consumed inside the transaction so a failed merge/attach rolls
		// the token back to unused.
		const ghostAccountId = await consumeClaimToken(trx, parsed.token);
		if (!ghostAccountId) {
			throw new ValidationError("Invalid or expired claim token");
		}

		const existing = await trx
			.selectFrom("accounts")
			.selectAll()
			.where("email", "=", email)
			.where("id", "!=", ghostAccountId)
			.executeTakeFirst();

		if (existing) {
			// Merge: keys (and their usage going forward) live on the existing
			// account; the ghost shell is dropped (cascades claim_tokens etc.).
			await trx
				.updateTable("api_keys")
				.set({ account_id: existing.id, tier: null })
				.where("account_id", "=", ghostAccountId)
				.execute();
			await trx
				.deleteFrom("accounts")
				.where("id", "=", ghostAccountId)
				.execute();
			return existing;
		}

		// Attach: the ghost account becomes a real account for this email.
		return trx
			.updateTable("accounts")
			.set({ email, ghost: false })
			.where("id", "=", ghostAccountId)
			.returningAll()
			.executeTakeFirstOrThrow();
	});

	const { raw, hash, prefix } = generateSessionToken();
	await db
		.insertInto("sessions")
		.values({
			token_hash: hash,
			token_prefix: prefix,
			account_id: account.id,
			ip_address: ip,
		})
		.execute();

	return c.json({
		sessionToken: raw,
		account: {
			id: account.id,
			email: account.email,
			plan: account.plan,
		},
	});
});

// Logout — revoke session (requires auth, handled by middleware)
app.post("/logout", async (c) => {
	const authHeader = c.req.header("authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return c.json({ error: "Missing authorization" }, 401);
	}

	const raw = authHeader.slice(7);
	if (!raw.startsWith("ss-sl_")) {
		return c.json({ error: "Logout requires a session token" }, 400);
	}

	const tokenHash = hashToken(raw);
	const db = getDb();

	await db
		.updateTable("sessions")
		.set({ revoked_at: new Date() })
		.where("token_hash", "=", tokenHash)
		.execute();

	return c.json({ message: "Logged out" });
});

export default app;
