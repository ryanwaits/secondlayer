/**
 * Public waitlist signup. No session — the contact field is the identity.
 *
 *   POST /api/public/waitlist  { list, contact, ...answers }
 *
 * Mounted only in platform mode. A list takes signups when it has a row in
 * `waitlists` with `closed_at` null AND an answer parser below; the parser
 * is what keeps a scripted POST from writing arbitrary JSON. A repeat
 * (list, contact, token) is a no-op that still answers 200, so the page
 * never tells a stranger who signed up.
 */

import { getDb } from "@secondlayer/shared/db";
import type { InsertWaitlistSignup } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { InvalidJSONError } from "../middleware/error.ts";

const app = new Hono();

type Answers = Record<string, string | null>;
type Parsed<T> = { ok: T } | { error: string };

/** Trimmed string within bounds, null when absent/blank, undefined when invalid. */
function text(value: unknown, max: number): string | null | undefined {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	return trimmed.length > max ? undefined : trimmed;
}

const ROBINHOOD_ROLES = ["issuer", "builder", "holder"] as const;

/** Stacks → Robinhood Chain bridge: which token, and who is asking. */
function parseRobinhoodAnswers(body: Record<string, unknown>): Parsed<Answers> {
	const role = body.role;
	if (
		typeof role !== "string" ||
		!(ROBINHOOD_ROLES as readonly string[]).includes(role)
	) {
		return { error: `role must be one of ${ROBINHOOD_ROLES.join(", ")}` };
	}
	const token = text(body.token, 64);
	if (!token) return { error: "token is required (64 characters max)" };
	const contract = text(body.contract, 160);
	if (contract === undefined) return { error: "contract is too long" };
	const note = text(body.note, 2000);
	if (note === undefined) return { error: "note is too long" };
	return { ok: { role, token, contract, note } };
}

/** One answer parser per list slug. A list with no parser takes no signups. */
export const WAITLIST_ANSWERS: Record<
	string,
	(body: Record<string, unknown>) => Parsed<Answers>
> = {
	robinhood: parseRobinhoodAnswers,
};

/** Validates a signup body into an insertable row, or names the bad field. */
export function parseSignup(
	body: Record<string, unknown>,
): Parsed<InsertWaitlistSignup> {
	const list = body.list;
	const parseAnswers =
		typeof list === "string" &&
		Object.prototype.hasOwnProperty.call(WAITLIST_ANSWERS, list)
			? WAITLIST_ANSWERS[list]
			: undefined;
	if (typeof list !== "string" || !parseAnswers) {
		return { error: "unknown waitlist" };
	}
	const contact = text(body.contact, 254);
	if (!contact || contact.length < 2) {
		return { error: "contact is required (Telegram, X handle, or email)" };
	}
	const answers = parseAnswers(body);
	if ("error" in answers) return answers;
	return { ok: { list, contact, answers: answers.ok } };
}

app.post("/", async (c) => {
	const body = await c.req.json().catch(() => {
		throw new InvalidJSONError();
	});
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return c.json({ error: "body must be a JSON object" }, 400);
	}
	const parsed = parseSignup(body as Record<string, unknown>);
	if ("error" in parsed) return c.json({ error: parsed.error }, 400);

	const db = getDb();
	const open = await db
		.selectFrom("waitlists")
		.select("slug")
		.where("slug", "=", parsed.ok.list)
		.where("closed_at", "is", null)
		.executeTakeFirst();
	if (!open) return c.json({ error: "this waitlist is closed" }, 410);

	// The unique index is on expressions (lower(contact), the token answer),
	// so conflict handling can't name columns; any unique violation is a repeat.
	await db
		.insertInto("waitlist_signups")
		.values(parsed.ok)
		.onConflict((oc) => oc.doNothing())
		.execute();

	return c.json({ ok: true });
});

export default app;
