import { getDb } from "@secondlayer/shared/db";
import {
	createMagicLink,
	isEmailAllowed,
	upsertAccount,
	verifyMagicLink,
	verifyMagicLinkByCode,
} from "@secondlayer/shared/db/queries/accounts";
import { ValidationError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { z } from "zod/v4";
import { sendMagicLink } from "../auth/email.ts";
import { getClientIp } from "../auth/http.ts";
import { generateSessionToken, hashToken } from "../auth/keys.ts";
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

	const allowed =
		process.env.DEV_MODE === "true" || (await isEmailAllowed(db, parsed.email));

	if (!allowed) {
		return c.json({ message: "Magic link sent. Check your email." });
	}

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
		...(process.env.DEV_MODE === "true" && { token, code }),
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

	const allowed =
		process.env.DEV_MODE === "true" || (await isEmailAllowed(db, email));
	if (!allowed) {
		throw new ValidationError("Invalid or expired token");
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
