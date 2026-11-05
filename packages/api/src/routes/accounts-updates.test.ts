import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import accountsRouter from "./accounts.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const accountIds: string[] = [];
const emails: string[] = [];

/** Stands in for the auth middleware: the account comes from a test header. */
function app() {
	const a = new Hono<{ Variables: { accountId: string } }>();
	a.onError(errorHandler);
	a.use("*", async (c, next) => {
		const id = c.req.header("x-test-account");
		if (id) c.set("accountId", id);
		await next();
	});
	a.route("/api/accounts", accountsRouter);
	return a;
}

async function account(): Promise<{ id: string; email: string }> {
	const email = `updates-${randomUUID()}@example.com`;
	const row = await db
		.insertInto("accounts")
		.values({ email })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	emails.push(email);
	return { id: row.id, email };
}

type ListStatus = "pending" | "confirmed" | "unsubscribed";

async function subscribe(email: string, status: ListStatus, token: string) {
	await db
		.insertInto("update_subscribers")
		.values({ email, status, token })
		.execute();
}

async function updatesOf(id: string) {
	const res = await app().request("/api/accounts/me/updates", {
		headers: { "x-test-account": id },
	});
	const body = (await res.json()) as {
		email: string | null;
		status: ListStatus | "none";
		token: string | null;
	};
	return { status: res.status, body };
}

afterAll(async () => {
	if (!HAS_DB) return;
	if (emails.length) {
		await db
			.deleteFrom("update_subscribers")
			.where((eb) => eb(eb.fn("lower", ["email"]), "in", emails))
			.execute();
	}
	if (accountIds.length) {
		await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
	}
});

describe.skipIf(!HAS_DB)("GET /api/accounts/me/updates", () => {
	test("an account not on the list reads none", async () => {
		const { id, email } = await account();
		const { status, body } = await updatesOf(id);
		expect(status).toBe(200);
		expect(body).toEqual({ email, status: "none", token: null });
	});

	test("a confirmed subscriber gets the unsubscribe token, matched ignoring case", async () => {
		const { id, email } = await account();
		const token = randomUUID();
		await subscribe(email.toUpperCase(), "confirmed", token);
		const { body } = await updatesOf(id);
		expect(body).toEqual({ email, status: "confirmed", token });
	});

	test("a pending address never hands out its token", async () => {
		const { id, email } = await account();
		await subscribe(email, "pending", randomUUID());
		const { body } = await updatesOf(id);
		expect(body.status).toBe("pending");
		expect(body.token).toBeNull();
	});

	test("no session is a 401", async () => {
		const res = await app().request("/api/accounts/me/updates");
		expect(res.status).toBe(401);
	});
});
