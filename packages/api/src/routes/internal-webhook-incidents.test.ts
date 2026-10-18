import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import internalWebhookIncidentsRouter from "./internal-webhook-incidents.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const accountIds: string[] = [];

const KEY = "test-workload-host-key";
const originalFetch = globalThis.fetch;
let prevKey: string | undefined;
let prevResend: string | undefined;
let sent: { to: string[]; subject: string; text: string }[];
/** Number of upcoming Resend calls that fail. */
let failSends = 0;

beforeEach(() => {
	prevKey = process.env.WORKLOAD_HOST_KEY;
	prevResend = process.env.RESEND_API_KEY;
	process.env.WORKLOAD_HOST_KEY = KEY;
	process.env.RESEND_API_KEY = "re_test";
	sent = [];
	failSends = 0;
	globalThis.fetch = (async (_url: string, init: RequestInit) => {
		const payload = JSON.parse(String(init.body));
		sent.push(payload);
		if (failSends > 0) {
			failSends--;
			return new Response("resend down", { status: 500 });
		}
		return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
	}) as unknown as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (prevKey === undefined) delete process.env.WORKLOAD_HOST_KEY;
	else process.env.WORKLOAD_HOST_KEY = prevKey;
	if (prevResend === undefined) delete process.env.RESEND_API_KEY;
	else process.env.RESEND_API_KEY = prevResend;
});

afterAll(async () => {
	if (!HAS_DB || accountIds.length === 0) return;
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

async function makeAccount(email: string | null): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email, ghost: email === null })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return row.id;
}

function app() {
	const a = new Hono();
	a.onError(errorHandler);
	a.route("/internal/webhook-incidents", internalWebhookIncidentsRouter);
	return a;
}

function down(id: string) {
	return {
		id,
		name: `hook ${id}`,
		host: `${id}.example.com`,
		failingSince: new Date(Date.now() - 20 * 60_000).toISOString(),
		failures: 8,
		lastError: null,
	};
}

function post(body: unknown, key: string | null = KEY) {
	return app().request("/internal/webhook-incidents", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(key ? { authorization: `Bearer ${key}` } : {}),
		},
		body: JSON.stringify(body),
	});
}

function report(accountId: string, ids: string[], downIds: string[]) {
	return {
		accountId,
		observedAt: new Date().toISOString(),
		webhookIds: ids,
		down: downIds.map(down),
	};
}

describe.skipIf(!HAS_DB)("POST /internal/webhook-incidents", () => {
	test("missing key → 401", async () => {
		const acct = await makeAccount(`owner-${crypto.randomUUID()}@example.com`);
		const res = await post(report(acct, [], []), null);
		expect(res.status).toBe(401);
	});

	test("the Sentinel key is not accepted → 401", async () => {
		process.env.SENTINEL_SERVICE_KEY = "sentinel-key";
		try {
			const acct = await makeAccount(
				`owner-${crypto.randomUUID()}@example.com`,
			);
			const res = await post(report(acct, [], []), "sentinel-key");
			expect(res.status).toBe(401);
		} finally {
			delete process.env.SENTINEL_SERVICE_KEY;
		}
	});

	test("invalid body → 400", async () => {
		const res = await post({ accountId: "nope" });
		expect(res.status).toBe(400);
	});

	test("stale observedAt → 400", async () => {
		const acct = await makeAccount(`owner-${crypto.randomUUID()}@example.com`);
		const res = await post({
			...report(acct, [], []),
			observedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
		});
		expect(res.status).toBe(400);
	});

	test("unknown account → 404", async () => {
		const res = await post(
			report("00000000-0000-4000-8000-000000000000", [], []),
		);
		expect(res.status).toBe(404);
	});

	test("new outage sends one email listing both webhooks, a repeat sends none, recovery resolves", async () => {
		const email = `owner-${crypto.randomUUID()}@example.com`;
		const acct = await makeAccount(email);

		const first = await post(report(acct, ["a", "b", "c"], ["a", "b"]));
		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({ opened: 2, resolved: 0 });
		expect(sent).toHaveLength(1);
		expect(sent[0]?.to).toEqual([email]);
		expect(sent[0]?.text).toContain("hook a");
		expect(sent[0]?.text).toContain("hook b");

		const repeat = await post(report(acct, ["a", "b", "c"], ["a", "b"]));
		expect(await repeat.json()).toEqual({ opened: 0, resolved: 0 });
		expect(sent).toHaveLength(1);

		const recovered = await post(report(acct, ["a", "b", "c"], []));
		expect(await recovered.json()).toEqual({ opened: 0, resolved: 2 });
		expect(sent).toHaveLength(1);

		const again = await post(report(acct, ["a", "b", "c"], ["a"]));
		expect(await again.json()).toEqual({ opened: 1, resolved: 0 });
		expect(sent).toHaveLength(2);

		const stamped = await db
			.selectFrom("webhook_incident_alerts")
			.select("emailed_at")
			.where("account_id", "=", acct)
			.execute();
		expect(stamped.every((r) => r.emailed_at !== null)).toBe(true);
	});

	test("a failed send is retried on the next report and then marked emailed", async () => {
		const acct = await makeAccount(`owner-${crypto.randomUUID()}@example.com`);
		failSends = 1;

		const first = await post(report(acct, ["a"], ["a"]));
		expect(first.status).toBe(200);
		expect(sent).toHaveLength(1);
		const unsent = await db
			.selectFrom("webhook_incident_alerts")
			.select(["emailed_at", "email_attempts"])
			.where("account_id", "=", acct)
			.executeTakeFirstOrThrow();
		expect(unsent.emailed_at).toBeNull();
		expect(unsent.email_attempts).toBe(1);

		await post(report(acct, ["a"], ["a"]));
		expect(sent).toHaveLength(2);
		const done = await db
			.selectFrom("webhook_incident_alerts")
			.select("emailed_at")
			.where("account_id", "=", acct)
			.executeTakeFirstOrThrow();
		expect(done.emailed_at).not.toBeNull();

		await post(report(acct, ["a"], ["a"]));
		expect(sent).toHaveLength(2);
	});

	test("gives up after 5 failed attempts", async () => {
		const acct = await makeAccount(`owner-${crypto.randomUUID()}@example.com`);
		failSends = 100;
		for (let i = 0; i < 8; i++) {
			await post(report(acct, ["a"], ["a"]));
		}
		expect(sent).toHaveLength(5);
		const row = await db
			.selectFrom("webhook_incident_alerts")
			.select(["emailed_at", "email_attempts"])
			.where("account_id", "=", acct)
			.executeTakeFirstOrThrow();
		expect(row.emailed_at).toBeNull();
		expect(row.email_attempts).toBe(5);
	});

	test("a retry batches every due incident into one email", async () => {
		const acct = await makeAccount(`owner-${crypto.randomUUID()}@example.com`);
		failSends = 1;
		await post(report(acct, ["a", "b"], ["a"]));
		await post(report(acct, ["a", "b"], ["a", "b"]));
		expect(sent).toHaveLength(2);
		expect(sent[1]?.text).toContain("hook a");
		expect(sent[1]?.text).toContain("hook b");
	});

	test("an incident that recovered before the retry is never emailed late", async () => {
		const acct = await makeAccount(`owner-${crypto.randomUUID()}@example.com`);
		failSends = 1;
		await post(report(acct, ["a"], ["a"]));
		await post(report(acct, ["a"], []));
		await post(report(acct, ["a"], []));
		expect(sent).toHaveLength(1);
	});

	test("an account without an email records the incident and sends nothing", async () => {
		const acct = await makeAccount(null);
		const res = await post(report(acct, ["a"], ["a"]));
		expect(await res.json()).toEqual({ opened: 1, resolved: 0 });
		expect(sent).toHaveLength(0);
	});

	describe("push", () => {
		async function claimedKeys(acct: string): Promise<string[]> {
			const rows = await db
				.selectFrom("push_sent")
				.select("key")
				.where("account_id", "=", acct)
				.execute();
			return rows.map((r) => r.key).sort();
		}
		async function incidentIds(acct: string): Promise<string[]> {
			const rows = await db
				.selectFrom("webhook_incident_alerts")
				.select("id")
				.where("account_id", "=", acct)
				.execute();
			return rows.map((r) => `webhook_incident:${r.id}`).sort();
		}

		test("a new incident claims one push keyed by the incident, even without an email", async () => {
			const acct = await makeAccount(null);
			await post(report(acct, ["a"], ["a"]));
			const keys = await claimedKeys(acct);
			expect(keys).toHaveLength(1);
			expect(keys).toEqual(await incidentIds(acct));
		});

		test("the same outage reported again claims no further push", async () => {
			const acct = await makeAccount(
				`owner-${crypto.randomUUID()}@example.com`,
			);
			await post(report(acct, ["a"], ["a"]));
			await post(report(acct, ["a"], ["a"]));
			expect(await claimedKeys(acct)).toHaveLength(1);
		});

		test("an email retry does not claim a push for the incident again", async () => {
			const acct = await makeAccount(
				`owner-${crypto.randomUUID()}@example.com`,
			);
			failSends = 1;
			await post(report(acct, ["a"], ["a"]));
			await post(report(acct, ["a"], ["a"]));
			expect(sent).toHaveLength(2);
			expect(await claimedKeys(acct)).toHaveLength(1);
		});
	});
});
