import { linkSentinelAccount } from "@secondlayer/platform/db/queries/accounts";
import { logger } from "@secondlayer/shared";
import { getDb, sql } from "@secondlayer/shared/db";
import {
	CLI_DEVICE_LOGIN_STATUSES,
	type CliDeviceLoginStatus,
	type CliDeviceProduct,
	type Database,
} from "@secondlayer/shared/db/schema";
import {
	casTransition,
	defineMachine,
} from "@secondlayer/shared/db/transition";
import { AuthorizationError, NotFoundError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import type { Transaction } from "kysely";
import { z } from "zod";
import { getClientIp } from "../auth/http.ts";
import { generateSessionToken, hashToken } from "../auth/keys.ts";
import { requireAuth } from "../auth/middleware.ts";
import { InvalidJSONError } from "../middleware/error.ts";

const app = new Hono();

/**
 * CLI sign-in lifecycle. A browser session answers a `pending` login once;
 * the CLI's poll consumes an `approved` one exactly once.
 */
export const CLI_DEVICE_LOGIN_MACHINE = defineMachine({
	states: CLI_DEVICE_LOGIN_STATUSES,
	transitions: {
		pending: ["approved", "denied"],
		approved: ["consumed"],
	},
});

const EXPIRES_IN_SECONDS = 15 * 60;
const POLL_INTERVAL_SECONDS = 5;
/** RFC 8628 alphabet: no vowels (no words) and no look-alikes. */
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
const USER_CODE_LENGTH = 8;

const CreateSchema = z.object({
	clientName: z.string().trim().min(1).max(64),
	// A closed set: the page's wording keys off it, so never free text.
	product: z.enum(["sentinel"]).optional(),
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

app.post("/", async (c) => {
	const { clientName, product } = CreateSchema.parse(await readJson(c));
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
				product: product ?? null,
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

	// Signing in makes a session (expires, revoked by `logout`), never an API
	// key: keys are for reading data and live on the Keys tab.
	const result = await db.transaction().execute(async (trx) => {
		CLI_DEVICE_LOGIN_MACHINE.assert("approved", "consumed");
		const claimed = await casTransition<CliDeviceLoginStatus>(trx, {
			table: "cli_device_logins",
			id: row.id,
			from: ["approved"],
			to: "consumed",
			set: { consumed_at: new Date() },
			stampUpdatedAt: false,
			returning: ["id"],
		});
		if (!claimed) {
			logger.warn("cli_device.consume_lost_race", { loginId: row.id });
			return null;
		}
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
	if (!result) return c.json({ error: "expired_token" }, 410);
	// `key` repeats the session token for CLI 21.3.0, which reads that field
	// and stores it as its bearer; a session token works wherever it did.
	return c.json({ ...result, key: result.sessionToken });
});

app.get("/:userCode", requireAuth(), async (c) => {
	requireSession(c);
	const row = await getDb()
		.selectFrom("cli_device_logins")
		.select(["client_name", "product", "status", "expires_at"])
		.where("user_code", "=", parseUserCode(c.req.param("userCode")))
		.where("expires_at", ">", sql<Date>`now()`)
		.executeTakeFirst();
	if (!row) throw new NotFoundError("Unknown or expired code");
	return c.json({
		clientName: row.client_name,
		product: row.product,
		status: row.status,
		expiresAt: row.expires_at.toISOString(),
	});
});

async function settle(
	userCode: string,
	set: Record<string, unknown>,
	then?: (
		trx: Transaction<Database>,
		row: { product: CliDeviceProduct | null },
	) => Promise<void>,
): Promise<boolean> {
	const db = getDb();
	const updated = await db.transaction().execute(async (trx) => {
		const row = await trx
			.updateTable("cli_device_logins")
			.set(set)
			.where("user_code", "=", userCode)
			.where("status", "=", "pending")
			.where("expires_at", ">", sql<Date>`now()`)
			.returning(["id", "product"])
			.executeTakeFirst();
		if (row && then) await then(trx, row);
		return row;
	});
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
	const ok = await settle(
		parseUserCode(c.req.param("userCode")),
		{ status: "approved", account_id: accountId, approved_at: new Date() },
		// Approving a Sentinel sign-in is the owner's consent for Sentinel to
		// use this account (and its balance). Kept if already linked.
		async (trx, row) => {
			if (row.product === "sentinel") {
				await linkSentinelAccount(trx, accountId, "consent");
			}
		},
	);
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
