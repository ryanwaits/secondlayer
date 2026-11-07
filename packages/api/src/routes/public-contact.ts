/**
 * "Talk to us" messages. No session: the email is the identity.
 *
 *   POST /api/public/contact  { name, email, message, company?, volume?, source_page? }
 *
 * Mounted only in platform mode. The row is stored first, then the operator
 * (`CONTACT_NOTIFY_EMAIL`) is emailed with Reply-To set to the sender; a
 * failed or skipped email leaves `notified_at` null and still answers 201,
 * because the row is the record. A hidden `website` field is a honeypot:
 * filled means a bot, answered with a fake id and nothing stored. The same
 * email twice within an hour answers the first row's id without a second
 * row or email, unless the operator was never emailed about the first one
 * (the worker retries those). Rate limit is its own bucket (`contact:<ip>`), not the
 * shared per-minute `ipRateLimit`.
 */

import { createHash } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import type { InsertContactRequest } from "@secondlayer/shared/db";
import { notifyContact } from "@secondlayer/shared/email";
import { RateLimitError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { getClientIp, ipBucket } from "../auth/http.ts";
import {
	type RateLimitStore,
	getRateLimitStore,
} from "../auth/rate-limit-store.ts";
import { InvalidJSONError } from "../middleware/error.ts";

export const CONTACT_VOLUMES = [
	"lt10m",
	"10m-100m",
	"100m-1b",
	"gt1b",
	"unsure",
] as const;
type Volume = (typeof CONTACT_VOLUMES)[number];

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 3_600_000;
const DUPLICATE_WINDOW_MS = 3_600_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KNOWN_FIELDS = new Set([
	"name",
	"email",
	"company",
	"volume",
	"message",
	"source_page",
	"website",
]);

type Parsed<T> = { ok: T } | { error: string };
export type ParsedContact = Omit<
	InsertContactRequest,
	"ip_hash" | "account_id" | "notified_at"
> & {
	name: string;
	email: string;
	message: string;
	company: string | null;
	volume: Volume | null;
	source_page: string | null;
};

/** Trimmed string; null when absent or blank; undefined when not a string. */
function trimmed(value: unknown): string | null | undefined {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") return undefined;
	const t = value.trim();
	return t.length === 0 ? null : t;
}

/** Validates a contact body into an insertable row, or names the bad field. */
export function parseContact(
	body: Record<string, unknown>,
): Parsed<ParsedContact> {
	for (const key of Object.keys(body)) {
		if (!KNOWN_FIELDS.has(key)) return { error: `unknown field: ${key}` };
	}

	const name = trimmed(body.name);
	if (!name) return { error: "name is required so we know who to reply to" };
	if (name.length > 120)
		return { error: "name is too long (120 characters max)" };

	const email = trimmed(body.email);
	if (!email) return { error: "email is required so we can reply" };
	if (email.length > 254 || !EMAIL_RE.test(email)) {
		return { error: "email must be a valid address, like you@company.com" };
	}

	const company = trimmed(body.company);
	if (company === undefined || (company && company.length > 160)) {
		return { error: "company must be text of 160 characters or fewer" };
	}

	const volume = trimmed(body.volume);
	if (
		volume === undefined ||
		(volume !== null &&
			!(CONTACT_VOLUMES as readonly string[]).includes(volume))
	) {
		return { error: `volume must be one of ${CONTACT_VOLUMES.join(", ")}` };
	}

	const message = trimmed(body.message);
	if (!message || message.length < 10) {
		return { error: "message is required (10 characters minimum)" };
	}
	if (message.length > 4000) {
		return { error: "message is too long (4000 characters max)" };
	}

	const page = trimmed(body.source_page);
	// A page path, never a URL: anything else is dropped, not rejected.
	const source_page = page?.startsWith("/") && page.length <= 200 ? page : null;

	return {
		ok: {
			name,
			email,
			company: company ?? null,
			volume: (volume as Volume | null) ?? null,
			message,
			source_page,
		},
	};
}

function hashIp(ip: string): string {
	return createHash("sha256").update(ip).digest("hex");
}

export function createContactRouter(opts?: {
	getDb?: typeof getDb;
	rateLimitStore?: RateLimitStore;
}) {
	const app = new Hono();
	const resolveDb = opts?.getDb ?? getDb;

	app.post("/", async (c) => {
		const body = await c.req.json().catch(() => {
			throw new InvalidJSONError();
		});
		if (!body || typeof body !== "object" || Array.isArray(body)) {
			return c.json({ error: "body must be a JSON object" }, 400);
		}
		const input = body as Record<string, unknown>;

		if (typeof input.website === "string" && input.website.trim() !== "") {
			return c.json({ id: crypto.randomUUID() }, 201);
		}

		const ip = getClientIp(c);
		const limit = await (opts?.rateLimitStore ?? getRateLimitStore()).check(
			`contact:${ipBucket(ip)}`,
			RATE_LIMIT,
			RATE_WINDOW_MS,
			{ failClosed: true },
		);
		if (!limit.allowed) {
			c.header("Retry-After", String(limit.retryAfter));
			throw new RateLimitError("Too many messages, try again later");
		}

		const parsed = parseContact(input);
		if ("error" in parsed) return c.json({ error: parsed.error }, 400);
		const row = parsed.ok;

		const db = resolveDb();
		const existing = await db
			.selectFrom("contact_requests")
			.select("id")
			.where((eb) =>
				eb(eb.fn("lower", ["email"]), "=", row.email.toLowerCase()),
			)
			// Only a message the operator was told about counts as a duplicate;
			// an unnotified one is still owed its email.
			.where("notified_at", "is not", null)
			.where("created_at", ">", new Date(Date.now() - DUPLICATE_WINDOW_MS))
			.orderBy("created_at", "desc")
			.executeTakeFirst();
		if (existing) return c.json({ id: existing.id }, 201);

		const inserted = await db
			.insertInto("contact_requests")
			.values({ ...row, ip_hash: hashIp(ip) })
			.returning("id")
			.executeTakeFirstOrThrow();

		if (await notifyContact(inserted.id, row)) {
			await db
				.updateTable("contact_requests")
				.set({ notified_at: new Date() })
				.where("id", "=", inserted.id)
				.execute();
		}

		return c.json({ id: inserted.id }, 201);
	});

	return app;
}

export default createContactRouter();
