import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { z } from "zod/v4";
import { sendWaitlistConfirmation } from "../auth/email.ts";
import { InvalidJSONError } from "../middleware/error.ts";

const app = new Hono();

const WaitlistSchema = z.object({
	email: z.string().email(),
	source: z.string().optional(),
});

app.post("/", async (c) => {
	const body = await c.req.json().catch(() => {
		throw new InvalidJSONError();
	});
	const { email, source } = WaitlistSchema.parse(body);
	const db = getDb();

	// Open beta (post 2026-05-14 shared-rip): auto-approve new entries so the
	// magic-link allow-check passes immediately. Waitlist table is preserved
	// as a kill-switch — set status='pending' admin-side to re-gate.
	const result = await db
		.insertInto("waitlist")
		.values({ email, status: "approved", ...(source ? { source } : {}) })
		.onConflict((oc) => oc.column("email").doNothing())
		.returning("id")
		.executeTakeFirst();

	if (result) {
		await sendWaitlistConfirmation(email);
	}

	return c.json({
		message: "You're in. Check your inbox for the sign-in link.",
	});
});

export default app;
