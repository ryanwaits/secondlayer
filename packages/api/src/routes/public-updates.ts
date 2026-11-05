/**
 * The email updates list (new posts and launches), double opt-in. No
 * session: the emailed token is the credential.
 *
 *   POST /api/public/updates              { email, source_page? }  join (always 202)
 *   POST /api/public/updates/confirm      { token }                confirm from the emailed link
 *   POST /api/public/updates/unsubscribe  ?t=token or { token }    opt out (also RFC 8058 one-click)
 *   POST /api/public/updates/resubscribe  { token }                opt back in
 *
 * Mounted only in platform mode. Joining never reveals list membership: the
 * answer is `202 { ok: true }` whether the address is new, pending,
 * confirmed or unsubscribed. A new or returning address gets a confirm email
 * (re-sent at most every 10 minutes while pending); a confirmed address gets
 * nothing. A hidden `website` field is a honeypot: filled means a bot,
 * answered 202 with nothing stored. Rate limit is its own bucket
 * (`updates:<ip>`), not the shared per-minute `ipRateLimit`. Unsubscribe is
 * exempt from the JSON-only write guard because mail providers POST it as a
 * form (see middleware/csrf.ts).
 */

import { createHash, randomBytes } from "node:crypto";
import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import {
	UPDATES_FROM,
	confirmEmail,
	sendEmail,
} from "@secondlayer/shared/email";
import { RateLimitError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { getClientIp } from "../auth/http.ts";
import {
	type RateLimitStore,
	getRateLimitStore,
} from "../auth/rate-limit-store.ts";
import { InvalidJSONError } from "../middleware/error.ts";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 3_600_000;
const CONFIRM_TTL_MS = 7 * 24 * 3_600_000;
const RESEND_COOLDOWN_MS = 10 * 60_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KNOWN_FIELDS = new Set(["email", "source_page", "website"]);

function hashIp(ip: string): string {
	return createHash("sha256").update(ip).digest("hex");
}

function newToken(): string {
	return randomBytes(32).toString("base64url");
}

/** The JSON object body, or null when it is not one. */
async function readObject(req: { json(): Promise<unknown> }): Promise<Record<
	string,
	unknown
> | null> {
	const body = await req.json().catch(() => {
		throw new InvalidJSONError();
	});
	if (!body || typeof body !== "object" || Array.isArray(body)) return null;
	return body as Record<string, unknown>;
}

function tokenOf(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 && value.length <= 200
		? value
		: null;
}

export function createUpdatesRouter(opts?: {
	getDb?: typeof getDb;
	rateLimitStore?: RateLimitStore;
	send?: typeof sendEmail;
}) {
	const app = new Hono();
	const resolveDb = opts?.getDb ?? getDb;
	const send = opts?.send ?? sendEmail;

	/** Emails the confirm link; true when it actually went out. */
	async function sendConfirm(email: string, token: string): Promise<boolean> {
		const { subject, html, text } = confirmEmail(token);
		try {
			const result = await send({
				to: email,
				from: UPDATES_FROM,
				subject,
				html,
				text,
			});
			return !result.skipped;
		} catch (err) {
			logger.error("updates.confirm_failed", {
				error: err instanceof Error ? err.message : String(err),
			});
			return false;
		}
	}

	app.post("/", async (c) => {
		const input = await readObject(c.req);
		if (!input) return c.json({ error: "body must be a JSON object" }, 400);

		if (typeof input.website === "string" && input.website.trim() !== "") {
			return c.json({ ok: true }, 202);
		}

		const ip = getClientIp(c);
		const limit = await (opts?.rateLimitStore ?? getRateLimitStore()).check(
			`updates:${ip}`,
			RATE_LIMIT,
			RATE_WINDOW_MS,
			{ failClosed: true },
		);
		if (!limit.allowed) {
			c.header("Retry-After", String(limit.retryAfter));
			throw new RateLimitError("Too many attempts, try again later");
		}

		for (const key of Object.keys(input)) {
			if (!KNOWN_FIELDS.has(key)) {
				return c.json({ error: `unknown field: ${key}` }, 400);
			}
		}
		const email = typeof input.email === "string" ? input.email.trim() : "";
		if (email.length > 254 || !EMAIL_RE.test(email)) {
			return c.json(
				{ error: "email must be a valid address, like you@example.com" },
				400,
			);
		}
		const page =
			typeof input.source_page === "string" ? input.source_page.trim() : "";
		// A page path, never a URL: anything else is dropped, not rejected.
		const sourcePage = page.startsWith("/") && page.length <= 200 ? page : null;

		const db = resolveDb();
		const existing = await db
			.selectFrom("update_subscribers")
			.select(["id", "status", "token", "confirm_sent_at"])
			.where((eb) => eb(eb.fn("lower", ["email"]), "=", email.toLowerCase()))
			.executeTakeFirst();

		if (!existing) {
			const token = newToken();
			// A concurrent join for the same address loses the unique index
			// race; it is already on its way, so it sends nothing.
			const inserted = await db
				.insertInto("update_subscribers")
				.values({
					email,
					token,
					source_page: sourcePage,
					ip_hash: hashIp(ip),
				})
				.onConflict((oc) => oc.doNothing())
				.returning("id")
				.executeTakeFirst();
			if (inserted && (await sendConfirm(email, token))) {
				await db
					.updateTable("update_subscribers")
					.set({ confirm_sent_at: new Date() })
					.where("id", "=", inserted.id)
					.execute();
			}
			return c.json({ ok: true }, 202);
		}

		if (existing.status === "confirmed") return c.json({ ok: true }, 202);

		if (existing.status === "unsubscribed") {
			await db
				.updateTable("update_subscribers")
				.set({ status: "pending", unsubscribed_at: null })
				.where("id", "=", existing.id)
				.execute();
		} else if (
			existing.confirm_sent_at &&
			Date.now() - existing.confirm_sent_at.getTime() < RESEND_COOLDOWN_MS
		) {
			return c.json({ ok: true }, 202);
		}

		if (await sendConfirm(email, existing.token)) {
			await db
				.updateTable("update_subscribers")
				.set({ confirm_sent_at: new Date() })
				.where("id", "=", existing.id)
				.execute();
		}
		return c.json({ ok: true }, 202);
	});

	app.post("/confirm", async (c) => {
		const input = await readObject(c.req);
		const token = tokenOf(input?.token);
		if (!token) return c.json({ status: "invalid" }, 404);

		const db = resolveDb();
		const row = await db
			.selectFrom("update_subscribers")
			.select(["id", "email", "status", "confirm_sent_at"])
			.where("token", "=", token)
			.executeTakeFirst();
		if (!row) return c.json({ status: "invalid" }, 404);

		if (row.status === "confirmed") {
			return c.json({ status: "confirmed", email: row.email });
		}
		const fresh =
			row.status === "pending" &&
			row.confirm_sent_at !== null &&
			Date.now() - row.confirm_sent_at.getTime() <= CONFIRM_TTL_MS;
		if (!fresh) return c.json({ status: "expired" }, 410);

		await db
			.updateTable("update_subscribers")
			.set({ status: "confirmed", confirmed_at: new Date() })
			.where("id", "=", row.id)
			.execute();
		return c.json({ status: "confirmed", email: row.email });
	});

	app.post("/unsubscribe", async (c) => {
		// One-click POSTs arrive form-encoded with the token in the query;
		// the body is ignored unless it is JSON carrying the token.
		let token = tokenOf(c.req.query("t"));
		if (!token) {
			const body = await c.req.json().catch(() => null);
			token = tokenOf((body as { token?: unknown } | null)?.token);
		}
		if (!token) return c.json({ status: "invalid" }, 404);

		const db = resolveDb();
		const row = await db
			.selectFrom("update_subscribers")
			.select(["id", "email", "status", "unsubscribed_at"])
			.where("token", "=", token)
			.executeTakeFirst();
		if (!row) return c.json({ status: "invalid" }, 404);

		if (row.status !== "unsubscribed") {
			await db
				.updateTable("update_subscribers")
				.set({ status: "unsubscribed", unsubscribed_at: new Date() })
				.where("id", "=", row.id)
				.execute();
		}
		return c.json({ status: "unsubscribed", email: row.email });
	});

	app.post("/resubscribe", async (c) => {
		const input = await readObject(c.req);
		const token = tokenOf(input?.token);
		if (!token) return c.json({ status: "invalid" }, 404);

		const db = resolveDb();
		const row = await db
			.selectFrom("update_subscribers")
			.select(["id", "email", "status"])
			.where("token", "=", token)
			.executeTakeFirst();
		if (!row) return c.json({ status: "invalid" }, 404);

		if (row.status === "pending") return c.json({ status: "pending" }, 409);
		if (row.status === "unsubscribed") {
			await db
				.updateTable("update_subscribers")
				.set({
					status: "confirmed",
					confirmed_at: new Date(),
					unsubscribed_at: null,
				})
				.where("id", "=", row.id)
				.execute();
		}
		return c.json({ status: "confirmed", email: row.email });
	});

	return app;
}

export default createUpdatesRouter();
