import { getDb, sql } from "@secondlayer/shared/db";
import { AuthorizationError, NotFoundError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { z } from "zod";
import { getClientIp } from "../auth/http.ts";
import { generateSessionToken, hashToken } from "../auth/keys.ts";
import { requireAuth } from "../auth/middleware.ts";
import { InvalidJSONError } from "../middleware/error.ts";

/**
 * Browser sign-in for the CLI (`sl login`), modeled on RFC 8628.
 *
 * The CLI creates an attempt (`POST /`) and polls `POST /token` with its secret
 * device code. A signed-in user approves the short user code in the browser
 * (`/:userCode/approve`). The key is minted on the first poll after approval,
 * so the plaintext exists only in that one response.
 */
const app = new Hono();

const EXPIRES_IN_SECONDS = 15 * 60;
const POLL_INTERVAL_SECONDS = 5;
/** RFC 8628 alphabet: no vowels (no words) and no look-alikes. */
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
const USER_CODE_LENGTH = 8;

const CreateSchema = z.object({
	clientName: z.string().trim().min(1).max(64),
});
const TokenSchema = z.object({ deviceCode: z.string().min(1).max(256) });

export function generateUserCode(): string {
	const chars: string[] = [];
	// Rejection sampling keeps the alphabet uniform (256 % 20 != 0).
	const limit = 256 - (256 % USER_CODE_ALPHABET.length);
	while (chars.length < USER_CODE_LENGTH) {
		for (const b of crypto.getRandomValues(new Uint8Array(16))) {
			if (b < limit && chars.length < USER_CODE_LENGTH) {
				chars.push(USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length]);
			}
		}
	}
	return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** `wdjb mjht`, `WDJBMJHT`, `wdjb-mjht` → `WDJB-MJHT`; null if malformed. */
export function normalizeUserCode(raw: string): string | null {
	const flat = raw.toUpperCase().replace(/[\s-]/g, "");
	if (flat.length !== USER_CODE_LENGTH) return null;
	for (const ch of flat) if (!USER_CODE_ALPHABET.includes(ch)) return null;
	return `${flat.slice(0, 4)}-${flat.slice(4)}`;
}

function generateDeviceCode(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function readJson(c: { req: { json(): Promise<unknown> } }) {
	return c.req.json().catch(() => {
		throw new InvalidJSONError();
	});
}

/** Approving and reading attempts is a signed-in-user action, never an API key. */
function requireSession(c: unknown): string {
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	const ctx = c as any;
	if (!ctx.get("session")) {
		throw new AuthorizationError(
			"Approve a CLI sign-in from a signed-in browser session, not an API key.",
		);
	}
	return ctx.get("accountId") as string;
}

function parseUserCode(raw: string): string {
	const code = normalizeUserCode(raw);
	if (!code) throw new NotFoundError("Unknown or expired code");
	return code;
}

// Start an attempt (no auth)
app.post("/", async (c) => {
	const { clientName } = CreateSchema.parse(await readJson(c));
	const db = getDb();
	const deviceCode = generateDeviceCode();
	const expiresAt = new Date(Date.now() + EXPIRES_IN_SECONDS * 1000);

	let userCode = "";
	for (let attempt = 0; attempt < 5; attempt++) {
		userCode = generateUserCode();
		const inserted = await db
			.insertInto("cli_device_logins")
			.values({
				device_code_hash: hashToken(deviceCode),
				user_code: userCode,
				client_name: clientName,
				expires_at: expiresAt,
			})
			.onConflict((oc) => oc.column("user_code").doNothing())
			.returning("id")
			.executeTakeFirst();
		if (inserted) break;
		userCode = "";
	}
	if (!userCode) throw new Error("Could not allocate a user code");

	const webUrl = process.env.WEB_URL ?? "https://secondlayer.tools";
	c.header("Cache-Control", "no-store");
	return c.json({
		deviceCode,
		userCode,
		verificationUrl: `${webUrl}/cli/login?code=${userCode}`,
		interval: POLL_INTERVAL_SECONDS,
		expiresIn: EXPIRES_IN_SECONDS,
	});
});

// Poll (no auth; the device code is the secret)
app.post("/token", async (c) => {
	const { deviceCode } = TokenSchema.parse(await readJson(c));
	const db = getDb();
	c.header("Cache-Control", "no-store");

	const row = await db
		.selectFrom("cli_device_logins")
		.selectAll()
		.where("device_code_hash", "=", hashToken(deviceCode))
		.executeTakeFirst();
	if (!row || row.expires_at <= new Date() || row.status === "consumed") {
		return c.json({ error: "expired_token" }, 410);
	}
	if (row.status === "pending") {
		return c.json({ error: "authorization_pending" }, 428);
	}
	if (row.status === "denied") {
		return c.json({ error: "access_denied" }, 403);
	}
	if (!row.account_id) return c.json({ error: "expired_token" }, 410);
	const accountId = row.account_id;

	// One transaction: claim the row, then open a session for the account.
	// Signing in makes a session (expires, revoked by `logout`), never an API
	// key: keys are for reading data and live on the Keys tab.
	const result = await db.transaction().execute(async (trx) => {
		const claimed = await trx
			.updateTable("cli_device_logins")
			.set({ status: "consumed", consumed_at: new Date() })
			.where("id", "=", row.id)
			.where("status", "=", "approved")
			.returning("id")
			.executeTakeFirst();
		if (!claimed) return null;
		const { raw, hash, prefix } = generateSessionToken();
		await trx
			.insertInto("sessions")
			.values({
				token_hash: hash,
				token_prefix: prefix,
				account_id: accountId,
				ip_address: getClientIp(c),
			})
			.execute();
		const account = await trx
			.selectFrom("accounts")
			.select(["id", "email"])
			.where("id", "=", accountId)
			.executeTakeFirstOrThrow();
		return { sessionToken: raw, account };
	});
	// Lost the race to a concurrent poll.
	if (!result) return c.json({ error: "expired_token" }, 410);
	// `key` repeats the session token for CLI 21.3.0, which reads that field
	// and stores it as its bearer; a session token works wherever it did.
	return c.json({ ...result, key: result.sessionToken });
});

// What the approval page shows (session)
app.get("/:userCode", requireAuth(), async (c) => {
	requireSession(c);
	const row = await getDb()
		.selectFrom("cli_device_logins")
		.select(["client_name", "status", "expires_at"])
		.where("user_code", "=", parseUserCode(c.req.param("userCode")))
		.where("expires_at", ">", sql<Date>`now()`)
		.executeTakeFirst();
	if (!row) throw new NotFoundError("Unknown or expired code");
	return c.json({
		clientName: row.client_name,
		status: row.status,
		expiresAt: row.expires_at.toISOString(),
	});
});

async function settle(
	userCode: string,
	set: Record<string, unknown>,
): Promise<boolean> {
	const db = getDb();
	const updated = await db
		.updateTable("cli_device_logins")
		.set(set)
		.where("user_code", "=", userCode)
		.where("status", "=", "pending")
		.where("expires_at", ">", sql<Date>`now()`)
		.returning("id")
		.executeTakeFirst();
	if (updated) return true;
	const exists = await db
		.selectFrom("cli_device_logins")
		.select("id")
		.where("user_code", "=", userCode)
		.where("expires_at", ">", sql<Date>`now()`)
		.executeTakeFirst();
	if (!exists) throw new NotFoundError("Unknown or expired code");
	return false;
}

app.post("/:userCode/approve", requireAuth(), async (c) => {
	const accountId = requireSession(c);
	const ok = await settle(parseUserCode(c.req.param("userCode")), {
		status: "approved",
		account_id: accountId,
		approved_at: new Date(),
	});
	if (!ok) {
		return c.json({ error: "Already answered", code: "CONFLICT" }, 409);
	}
	return c.json({ status: "approved" });
});

app.post("/:userCode/deny", requireAuth(), async (c) => {
	requireSession(c);
	const ok = await settle(parseUserCode(c.req.param("userCode")), {
		status: "denied",
	});
	if (!ok) {
		return c.json({ error: "Already answered", code: "CONFLICT" }, 409);
	}
	return c.json({ status: "denied" });
});

export default app;
