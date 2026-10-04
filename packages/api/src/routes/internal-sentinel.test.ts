import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { randomUUID } from "node:crypto";
import { PRICES } from "@secondlayer/platform/billing/prices";
import {
	creditCredits,
	getCreditRefill,
	getCredits,
} from "@secondlayer/platform/db/queries/account-credits";
import {
	getCaps,
	upsertCaps,
} from "@secondlayer/platform/db/queries/account-spend-caps";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import type Stripe from "stripe";
import { generateSessionToken, hashToken } from "../auth/keys.ts";
import { createApiApp } from "../create-app.ts";
import { errorHandler } from "../middleware/error.ts";
import type { StripeClient } from "./billing.ts";
import {
	MAX_GRANT_USD_MICROS,
	MAX_REFUND_USD_MICROS,
	type SentinelAreas,
	buildReturnUrl,
	createInternalSentinelRouter,
	parseAreas,
} from "./internal-sentinel.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

const KEY = "test-sentinel-key";
const accountIds: string[] = [];
const emails: string[] = [];

/** A pre-existing account; linked to Sentinel unless `linked` is false. */
async function makeAccount(
	email: string | null = null,
	linked = true,
): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email, ghost: email === null })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	if (linked) {
		await db
			.insertInto("sentinel_accounts")
			.values({ account_id: row.id, via: "consent" })
			.execute();
	}
	return row.id;
}

type StripeCall = {
	success_url?: string;
	cancel_url?: string;
	amount?: number;
};

function stubStripe(calls: StripeCall[] = []): StripeClient {
	return {
		customers: {
			// A fresh id per customer: accounts.stripe_customer_id is unique.
			create: async () =>
				({ id: `cus_${randomUUID()}` }) as unknown as Stripe.Customer,
			retrieve: async (id: string) =>
				({ id, deleted: false }) as unknown as Stripe.Customer,
		},
		checkout: {
			sessions: {
				create: async (params: Stripe.Checkout.SessionCreateParams) => {
					calls.push({
						success_url: params.success_url ?? undefined,
						cancel_url: params.cancel_url ?? undefined,
						amount: params.line_items?.[0]?.price_data?.unit_amount,
					});
					return { url: "https://checkout.stripe.test/session" };
				},
			},
		},
	} as unknown as StripeClient;
}

function app(getStripe: () => StripeClient | null = () => stubStripe()) {
	const a = new Hono();
	a.onError(errorHandler);
	a.route("/internal/sentinel", createInternalSentinelRouter({ getStripe }));
	return a;
}

function post(a: Hono, path: string, body: unknown, key: string | null = KEY) {
	return a.request(`/internal/sentinel${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(key ? { authorization: `Bearer ${key}` } : {}),
		},
		body: JSON.stringify(body),
	});
}

let prevSentinel: string | undefined;
let prevWorkload: string | undefined;
let prevWebUrl: string | undefined;

beforeEach(() => {
	prevSentinel = process.env.SENTINEL_SERVICE_KEY;
	prevWorkload = process.env.WORKLOAD_HOST_KEY;
	prevWebUrl = process.env.SENTINEL_WEB_URL;
	process.env.SENTINEL_SERVICE_KEY = KEY;
	process.env.WORKLOAD_HOST_KEY = "test-workload-host-key";
	delete process.env.SENTINEL_WEB_URL;
});

afterEach(() => {
	for (const [k, v] of [
		["SENTINEL_SERVICE_KEY", prevSentinel],
		["WORKLOAD_HOST_KEY", prevWorkload],
		["SENTINEL_WEB_URL", prevWebUrl],
	] as const) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

afterAll(async () => {
	if (!HAS_DB) return;
	const ids = [...accountIds];
	if (emails.length > 0) {
		const rows = await db
			.selectFrom("accounts")
			.select("id")
			.where("email", "in", emails)
			.execute();
		ids.push(...rows.map((r) => r.id));
	}
	if (ids.length === 0) return;
	await db.deleteFrom("api_keys").where("account_id", "in", ids).execute();
	await db.deleteFrom("sessions").where("account_id", "in", ids).execute();
	await db.deleteFrom("usage_ledger").where("account_id", "in", ids).execute();
	await db
		.deleteFrom("account_spend_caps")
		.where("account_id", "in", ids)
		.execute();
	await db
		.deleteFrom("account_credits")
		.where("account_id", "in", ids)
		.execute();
	await db.deleteFrom("accounts").where("id", "in", ids).execute();
});

describe("buildReturnUrl", () => {
	test("builds from the default origin", () => {
		expect(buildReturnUrl("/app/billing", "success", {})).toBe(
			"https://runsentinel.app/app/billing?topup=success",
		);
	});

	test("honours SENTINEL_WEB_URL and existing query", () => {
		expect(
			buildReturnUrl("/a?x=1", "cancelled", {
				SENTINEL_WEB_URL: "https://staging.example.com/ignored",
			}),
		).toBe("https://staging.example.com/a?x=1&topup=cancelled");
	});

	test.each([
		"//evil.com",
		"//evil.com/x",
		"https://evil.com",
		"evil.com/x",
		"",
		"/\\evil.com",
		"/ok\nbad",
		"\\\\evil.com",
	])("rejects %j", (path) => {
		expect(() => buildReturnUrl(path, "success", {})).toThrow();
	});

	test("rejects non-strings", () => {
		expect(() => buildReturnUrl(undefined, "success", {})).toThrow();
		expect(() => buildReturnUrl(42, "success", {})).toThrow();
	});
});

describe("/internal/sentinel auth", () => {
	const routes: [string, unknown][] = [
		["/accounts/resolve", { email: "a@b.co" }],
		["/accounts/link", {}],
		["/accounts/grant", {}],
		["/accounts/summary", {}],
		["/accounts/settle", {}],
		["/settings", {}],
		["/affordable", {}],
		["/checkout", {}],
		["/tokens/resolve", {}],
		["/keys", {}],
	];

	test.each(routes)("%s: missing key → 401", async (path, body) => {
		expect((await post(app(), path, body, null)).status).toBe(401);
	});

	test.each(routes)("%s: wrong key → 401", async (path, body) => {
		expect((await post(app(), path, body, "nope")).status).toBe(401);
	});

	test.each(routes)("%s: workload host key → 401", async (path, body) => {
		expect(
			(await post(app(), path, body, "test-workload-host-key")).status,
		).toBe(401);
	});

	test.each(routes)(
		"%s: unset SENTINEL_SERVICE_KEY → 401",
		async (path, body) => {
			delete process.env.SENTINEL_SERVICE_KEY;
			expect((await post(app(), path, body, KEY)).status).toBe(401);
		},
	);

	test("the workload host key can't stand in even if configured identically", async () => {
		process.env.SENTINEL_SERVICE_KEY = "shared";
		process.env.WORKLOAD_HOST_KEY = "shared";
		expect(
			(await post(app(), "/accounts/resolve", { email: "a@b.co" }, "shared"))
				.status,
		).toBe(401);
	});
});

describe.skipIf(!HAS_DB)("/internal/sentinel routes", () => {
	test("mounted in platform mode with the Sentinel key, not in oss mode", async () => {
		const body = JSON.stringify({ email: `mount-${randomUUID()}@example.com` });
		emails.push(JSON.parse(body).email);
		const headers = {
			"content-type": "application/json",
			authorization: `Bearer ${KEY}`,
		};
		const res = await createApiApp("platform").request(
			"/internal/sentinel/accounts/resolve",
			{ method: "POST", headers, body },
		);
		expect(res.status).toBe(200);
		const oss = await createApiApp("oss").request(
			"/internal/sentinel/accounts/resolve",
			{ method: "POST", headers, body },
		);
		expect(oss.status).toBe(404);
	});

	test("resolve lowercases + trims, is idempotent, hadAccount is correct", async () => {
		const email = `Sentinel-${randomUUID()}@Example.COM`;
		const lower = email.toLowerCase();
		emails.push(lower);

		const first = await post(app(), "/accounts/resolve", {
			email: `  ${email}  `,
		});
		expect(first.status).toBe(200);
		const a = (await first.json()) as {
			accountId: string;
			created: boolean;
			hadAccount: boolean;
			linked: boolean;
		};
		expect(a.created).toBe(true);
		expect(a.hadAccount).toBe(false);
		expect((a as { linked?: boolean }).linked).toBe(true);
		const linkRow = await db
			.selectFrom("sentinel_accounts")
			.select("via")
			.where("account_id", "=", a.accountId)
			.executeTakeFirstOrThrow();
		expect(linkRow.via).toBe("created");

		const stored = await db
			.selectFrom("accounts")
			.select("email")
			.where("id", "=", a.accountId)
			.executeTakeFirstOrThrow();
		expect(stored.email).toBe(lower);

		const second = await post(app(), "/accounts/resolve", { email: lower });
		const b = (await second.json()) as typeof a;
		expect(b).toEqual({
			accountId: a.accountId,
			created: false,
			hadAccount: true,
			linked: true,
		});
	});

	test("resolve finds a pre-existing account stored with mixed case", async () => {
		const mixed = `Legacy-${randomUUID()}@Example.com`;
		const id = await makeAccount(mixed, false);
		const res = await post(app(), "/accounts/resolve", { email: mixed });
		expect(await res.json()).toEqual({
			accountId: id,
			created: false,
			hadAccount: true,
			linked: false,
		});
		// Resolving an existing account must not link it.
		const rows = await db
			.selectFrom("sentinel_accounts")
			.select("account_id")
			.where("account_id", "=", id)
			.execute();
		expect(rows).toHaveLength(0);
	});

	test("resolve rejects a bad email", async () => {
		expect(
			(await post(app(), "/accounts/resolve", { email: "nope" })).status,
		).toBe(400);
		expect((await post(app(), "/accounts/resolve", {})).status).toBe(400);
	});

	test("grant is idempotent by key", async () => {
		const accountId = await makeAccount();
		const body = {
			accountId,
			usdMicros: 5_000_000,
			reason: "starter",
			idempotencyKey: `sentinel:starter:${accountId}`,
		};
		const first = await post(app(), "/accounts/grant", body);
		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({
			granted: true,
			balanceAfter: 5_000_000,
		});
		const second = await post(app(), "/accounts/grant", body);
		expect(await second.json()).toEqual({
			granted: false,
			balanceAfter: 5_000_000,
		});
		expect(await getCredits(db, accountId)).toBe(5_000_000n);
	});

	test("grant over the cap is refused, nothing credited", async () => {
		const accountId = await makeAccount();
		const res = await post(app(), "/accounts/grant", {
			accountId,
			usdMicros: Number(MAX_GRANT_USD_MICROS) + 1,
			reason: "starter",
			idempotencyKey: `sentinel:starter:${accountId}`,
		});
		expect(res.status).toBe(400);
		expect(await getCredits(db, accountId)).toBe(0n);
	});

	test("a top-up grant is allowed; Sentinel grants never exceed the cap in total", async () => {
		const accountId = await makeAccount();
		const grant = (usdMicros: number, kind: string) =>
			post(app(), "/accounts/grant", {
				accountId,
				usdMicros,
				reason: kind,
				idempotencyKey: `sentinel:${kind}:${accountId}`,
			});
		expect((await grant(5_000_000, "starter")).status).toBe(200);
		// The top-up past the cap is refused; the one that fits is credited once.
		const over = await grant(5_000_001, "starter-topup");
		expect(over.status).toBe(409);
		expect(await over.json()).toMatchObject({ error: "grant_total_exceeded" });
		expect((await grant(5_000_000, "starter-topup")).status).toBe(200);
		const retry = await grant(5_000_000, "starter-topup");
		expect(retry.status).toBe(200);
		expect(await retry.json()).toEqual({
			granted: false,
			balanceAfter: 10_000_000,
		});
		expect(await getCredits(db, accountId)).toBe(10_000_000n);
	});

	test("a new account's $10 starter leaves no room for a top-up", async () => {
		const accountId = await makeAccount();
		const grant = (usdMicros: number, kind: string) =>
			post(app(), "/accounts/grant", {
				accountId,
				usdMicros,
				reason: kind,
				idempotencyKey: `sentinel:${kind}:${accountId}`,
			});
		expect((await grant(10_000_000, "starter")).status).toBe(200);
		expect((await grant(1_000_000, "starter-topup")).status).toBe(409);
		expect(await getCredits(db, accountId)).toBe(10_000_000n);
	});

	test("refund cap is the largest Sentinel unit price", () => {
		expect(MAX_REFUND_USD_MICROS).toBe(PRICES["sentinel.deep_audit"]);
	});

	const refund = (accountId: string, runId: string, usdMicros: number) =>
		post(app(), "/accounts/grant", {
			accountId,
			usdMicros,
			reason: "refund",
			idempotencyKey: `sentinel:refund:${runId}`,
		});
	const runId = () => `aud_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

	test("a run refund is credited once, labelled sentinel:refund", async () => {
		const accountId = await makeAccount();
		const run = runId();
		const first = await refund(accountId, run, 1_500_000);
		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({
			granted: true,
			balanceAfter: 1_500_000,
		});
		const retry = await refund(accountId, run, 1_500_000);
		expect(retry.status).toBe(200);
		expect(await retry.json()).toEqual({
			granted: false,
			balanceAfter: 1_500_000,
		});
		const rows = await db
			.selectFrom("usage_ledger")
			.select(["source", "idempotency_key"])
			.where("account_id", "=", accountId)
			.execute();
		expect(rows).toEqual([
			{ source: "sentinel:refund", idempotency_key: `sentinel:refund:${run}` },
		]);
	});

	test("a refund over the largest unit price is refused, nothing credited", async () => {
		const accountId = await makeAccount();
		const res = await refund(
			accountId,
			runId(),
			Number(MAX_REFUND_USD_MICROS) + 1,
		);
		expect(res.status).toBe(400);
		expect(await getCredits(db, accountId)).toBe(0n);
	});

	test("refunds don't count toward the starter cap", async () => {
		const accountId = await makeAccount();
		const starter = await post(app(), "/accounts/grant", {
			accountId,
			usdMicros: 10_000_000,
			reason: "starter",
			idempotencyKey: `sentinel:starter:${accountId}`,
		});
		expect(starter.status).toBe(200);
		expect((await refund(accountId, runId(), 3_000_000)).status).toBe(200);
		expect((await refund(accountId, runId(), 3_000_000)).status).toBe(200);
		expect(await getCredits(db, accountId)).toBe(16_000_000n);
	});

	test("refund rejects a malformed run id", async () => {
		const accountId = await makeAccount();
		for (const bad of [
			"",
			"aud_",
			"aud_XYZ",
			"run_abc123",
			`aud_abc123:${accountId}`,
			"aud_abc 123",
		]) {
			expect((await refund(accountId, bad, 1_500_000)).status).toBe(400);
		}
		expect(await getCredits(db, accountId)).toBe(0n);
	});

	test("grant rejects zero, negative, fractional, bad key, unknown account", async () => {
		const accountId = await makeAccount();
		const base = {
			accountId,
			usdMicros: 1_000_000,
			reason: "starter",
			idempotencyKey: `sentinel:starter:${accountId}`,
		};
		for (const bad of [
			{ usdMicros: 0 },
			{ usdMicros: -5 },
			{ usdMicros: 1.5 },
			{ usdMicros: "5000000" },
			{ idempotencyKey: "starter" },
			{ idempotencyKey: `sentinel:bonus:${accountId}` },
			{ idempotencyKey: `sentinel:starter:${randomUUID()}` },
			{ reason: "has space" },
		]) {
			const res = await post(app(), "/accounts/grant", { ...base, ...bad });
			expect(res.status).toBe(400);
		}
		const ghostId = randomUUID();
		const missing = await post(app(), "/accounts/grant", {
			...base,
			accountId: ghostId,
			idempotencyKey: `sentinel:starter:${ghostId}`,
		});
		expect(missing.status).toBe(404);
		expect(await getCredits(db, accountId)).toBe(0n);
	});

	test("summary returns balance, spend, cap and prices from PRICES", async () => {
		const accountId = await makeAccount();
		await creditCredits(db, accountId, 7_000_000n);
		await upsertCaps(db, accountId, { monthly_cap_cents: 2500 });
		const res = await post(app(), "/accounts/summary", { accountId });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			balanceUsdMicros: 7_000_000,
			spentMonthUsdMicros: 0,
			monthlyCapCents: 2500,
			owedUsdMicros: 0,
			refill: null,
			prices: {
				run: Number(PRICES["sentinel.run"]),
				deep_audit: Number(PRICES["sentinel.deep_audit"]),
				monitored_event: Number(PRICES["sentinel.monitored_event"]),
			},
		});
	});

	test("summary: no cap → null; unknown account → 404", async () => {
		const accountId = await makeAccount();
		const res = await post(app(), "/accounts/summary", { accountId });
		const body = (await res.json()) as { monthlyCapCents: number | null };
		expect(body.monthlyCapCents).toBeNull();
		expect(
			(await post(app(), "/accounts/summary", { accountId: randomUUID() }))
				.status,
		).toBe(404);
		expect(
			(await post(app(), "/accounts/summary", { accountId: "not-a-uuid" }))
				.status,
		).toBe(404);
	});

	test("affordable: ok, balance, cap", async () => {
		const accountId = await makeAccount();

		const none = await post(app(), "/affordable", {
			accountId,
			unit: "sentinel.run",
			quantity: 1,
		});
		expect(await none.json()).toEqual({
			ok: false,
			priceUsdMicros: 1_500_000,
			balanceUsdMicros: 0,
			reason: "balance",
		});

		await creditCredits(db, accountId, 10_000_000n);
		const ok = await post(app(), "/affordable", {
			accountId,
			unit: "run",
			quantity: 2,
		});
		expect(await ok.json()).toEqual({
			ok: true,
			priceUsdMicros: 3_000_000,
			balanceUsdMicros: 10_000_000,
		});

		// $2 cap: one $1.50 run fits, two do not.
		await upsertCaps(db, accountId, { monthly_cap_cents: 200 });
		const one = await post(app(), "/affordable", {
			accountId,
			unit: "sentinel.run",
			quantity: 1,
		});
		expect(((await one.json()) as { ok: boolean }).ok).toBe(true);
		const two = await post(app(), "/affordable", {
			accountId,
			unit: "sentinel.run",
			quantity: 2,
		});
		expect(await two.json()).toEqual({
			ok: false,
			priceUsdMicros: 3_000_000,
			balanceUsdMicros: 10_000_000,
			reason: "cap",
		});
		// Pure check: nothing debited.
		expect(await getCredits(db, accountId)).toBe(10_000_000n);
	});

	test("affordable rejects non-sentinel units and bad quantities", async () => {
		const accountId = await makeAccount();
		for (const bad of [
			{ unit: "webhook.event", quantity: 1 },
			{ unit: "rows.delivered", quantity: 1 },
			{ unit: "sentinel.run", quantity: 0 },
			{ unit: "sentinel.run", quantity: -1 },
			{ unit: "sentinel.run", quantity: 1.5 },
		]) {
			const res = await post(app(), "/affordable", { accountId, ...bad });
			expect(res.status).toBe(400);
		}
	});

	test("checkout rejects non-allow-listed returnPath and bad packs", async () => {
		const accountId = await makeAccount();
		const calls: StripeCall[] = [];
		const a = app(() => stubStripe(calls));
		for (const returnPath of [
			"//evil.com",
			"https://evil.com/x",
			"evil",
			"/\\evil.com",
		]) {
			const res = await post(a, "/checkout", {
				accountId,
				packUsd: 10,
				returnPath,
			});
			expect(res.status).toBe(400);
		}
		for (const bad of [
			{ amountUsd: 4 },
			{ amountUsd: 1001 },
			{ amountUsd: 12.5 },
			{ amountUsd: "20" },
			{},
		]) {
			expect(
				(await post(a, "/checkout", { accountId, returnPath: "/ok", ...bad }))
					.status,
			).toBe(400);
		}
		expect(calls).toHaveLength(0);
	});

	test("checkout returns a Stripe URL with Sentinel-origin return URLs", async () => {
		const accountId = await makeAccount(`co-${randomUUID()}@example.com`);
		const calls: StripeCall[] = [];
		const res = await post(
			app(() => stubStripe(calls)),
			"/checkout",
			{
				accountId,
				packUsd: 25,
				returnPath: "/app/billing",
			},
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			url: "https://checkout.stripe.test/session",
		});
		expect(calls).toEqual([
			{
				success_url: "https://runsentinel.app/app/billing?topup=success",
				cancel_url: "https://runsentinel.app/app/billing?topup=cancelled",
				amount: 2500,
			},
		]);
	});

	test("checkout takes a custom whole-dollar amount, and the older packUsd name", async () => {
		const accountId = await makeAccount(`co-${randomUUID()}@example.com`);
		const calls: StripeCall[] = [];
		const a = app(() => stubStripe(calls));
		for (const body of [
			{ amountUsd: 7 },
			{ amountUsd: 1000 },
			{ packUsd: 10 },
		]) {
			const res = await post(a, "/checkout", {
				accountId,
				returnPath: "/app",
				...body,
			});
			expect(res.status).toBe(200);
		}
		expect(calls.map((c) => c.amount)).toEqual([700, 100_000, 1000]);
	});

	test("checkout: Stripe not configured → 503", async () => {
		const accountId = await makeAccount();
		const res = await post(
			app(() => null),
			"/checkout",
			{
				accountId,
				packUsd: 10,
				returnPath: "/x",
			},
		);
		expect(res.status).toBe(503);
	});

	test("link: consent links an existing account, idempotent, 404 unknown", async () => {
		const id = await makeAccount(`link-${randomUUID()}@example.com`, false);
		for (let i = 0; i < 2; i++) {
			const res = await post(app(), "/accounts/link", { accountId: id });
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ linked: true });
		}
		const rows = await db
			.selectFrom("sentinel_accounts")
			.select("via")
			.where("account_id", "=", id)
			.execute();
		expect(rows).toEqual([{ via: "consent" }]);
		expect(
			(await post(app(), "/accounts/link", { accountId: randomUUID() })).status,
		).toBe(404);
		expect(
			(await post(app(), "/accounts/link", { accountId: "nope" })).status,
		).toBe(404);
	});

	test("unlinked account: grant/summary/affordable/checkout → 403 account_not_linked, nothing moves", async () => {
		const id = await makeAccount(`unl-${randomUUID()}@example.com`, false);
		await creditCredits(db, id, 3_000_000n);
		const calls: StripeCall[] = [];
		const a = app(() => stubStripe(calls));
		const attempts: [string, unknown][] = [
			[
				"/accounts/grant",
				{
					accountId: id,
					usdMicros: 5_000_000,
					reason: "starter",
					idempotencyKey: `sentinel:starter:${id}`,
				},
			],
			["/accounts/summary", { accountId: id }],
			["/accounts/settle", { accountId: id }],
			["/settings", { accountId: id, monthlyCapCents: 500 }],
			["/affordable", { accountId: id, unit: "sentinel.run", quantity: 1 }],
			["/checkout", { accountId: id, packUsd: 10, returnPath: "/x" }],
		];
		for (const [path, body] of attempts) {
			const res = await post(a, path, body);
			expect(res.status).toBe(403);
			expect(await res.json()).toMatchObject({ error: "account_not_linked" });
		}
		expect(calls).toHaveLength(0);
		expect(await getCredits(db, id)).toBe(3_000_000n);
		expect(await getCaps(db, id)).toBeNull();
		const ledger = await db
			.selectFrom("usage_ledger")
			.select("id")
			.where("account_id", "=", id)
			.execute();
		expect(ledger).toHaveLength(0);
	});

	test("a second grant with a different key is refused; only the starter key works, once", async () => {
		const id = await makeAccount();
		const grant = (idempotencyKey: string) =>
			post(app(), "/accounts/grant", {
				accountId: id,
				usdMicros: 5_000_000,
				reason: "starter",
				idempotencyKey,
			});
		expect((await grant(`sentinel:starter:${id}`)).status).toBe(200);
		expect((await grant(`sentinel:starter:${id}-2`)).status).toBe(400);
		expect((await grant(`sentinel:again:${id}`)).status).toBe(400);
		expect(await getCredits(db, id)).toBe(5_000_000n);
	});

	async function owe(
		accountId: string,
		unit: string,
		usdMicros: number,
		n: number,
	) {
		await db
			.insertInto("usage_ledger")
			.values({
				account_id: accountId,
				unit,
				quantity: 1,
				usd_micros: usdMicros,
				debited: false,
				source: "test",
				idempotency_key: `t:${randomUUID()}`,
				occurred_at: new Date(Date.UTC(2026, 8, n)),
			})
			.execute();
	}

	test("summary returns owed (sentinel.* only) and refill", async () => {
		const id = await makeAccount();
		await owe(id, "sentinel.run", 1_500_000, 1);
		await owe(id, "webhook.event", 42, 2);
		const a = app();
		let s = (await (
			await post(a, "/accounts/summary", { accountId: id })
		).json()) as Record<string, unknown>;
		expect(s.owedUsdMicros).toBe(1_500_000);
		expect(s.refill).toBeNull();
		await post(a, "/settings", {
			accountId: id,
			refill: { belowUsd: 5, packUsd: 25 },
		});
		s = (await (
			await post(a, "/accounts/summary", { accountId: id })
		).json()) as Record<string, unknown>;
		expect(s.refill).toEqual({ belowUsd: 5, packUsd: 25 });
	});

	test("settle collects owed sentinel rows, oldest first, leaves other units", async () => {
		const id = await makeAccount();
		await owe(id, "sentinel.deep_audit", 3_000_000, 1);
		await owe(id, "sentinel.run", 1_500_000, 2);
		await owe(id, "rows.delivered", 900_000, 1);
		await creditCredits(db, id, 4_000_000n);
		const res = await post(app(), "/accounts/settle", { accountId: id });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			settledUsdMicros: 3_000_000,
			owedUsdMicros: 1_500_000,
			balanceUsdMicros: 1_000_000,
		});
		const again = await post(app(), "/accounts/settle", { accountId: id });
		expect(await again.json()).toEqual({
			settledUsdMicros: 0,
			owedUsdMicros: 1_500_000,
			balanceUsdMicros: 1_000_000,
		});
		const other = await db
			.selectFrom("usage_ledger")
			.select("debited")
			.where("account_id", "=", id)
			.where("unit", "=", "rows.delivered")
			.executeTakeFirstOrThrow();
		expect(other.debited).toBe(false);
	});

	test("settings writes cap + refill like the session routes, validates first", async () => {
		const id = await makeAccount();
		const a = app();
		const ok = await post(a, "/settings", {
			accountId: id,
			monthlyCapCents: 2500,
			refill: { belowUsd: 3, packUsd: 50 },
		});
		expect(ok.status).toBe(200);
		expect(await ok.json()).toEqual({
			monthlyCapCents: 2500,
			refill: { belowUsd: 3, packUsd: 50 },
		});
		expect((await getCaps(db, id))?.monthly_cap_cents).toBe(2500);
		expect((await getCreditRefill(db, id)).packUsd).toBe(50);

		// pack defaults to 25 like the session route
		await post(a, "/settings", { accountId: id, refill: { belowUsd: 2 } });
		expect((await getCreditRefill(db, id)).packUsd).toBe(25);

		// omitted fields are left alone
		await post(a, "/settings", { accountId: id, monthlyCapCents: 0 });
		expect((await getCaps(db, id))?.monthly_cap_cents).toBe(0);
		expect((await getCreditRefill(db, id)).belowUsdMicros).toBe(2_000_000n);

		// null turns things off
		const off = await post(a, "/settings", {
			accountId: id,
			monthlyCapCents: null,
			refill: { belowUsd: null },
		});
		expect(await off.json()).toEqual({ monthlyCapCents: null, refill: null });
		expect((await getCreditRefill(db, id)).packUsd).toBeNull();

		// invalid input: 400 and nothing written (even the valid half)
		await post(a, "/settings", { accountId: id, monthlyCapCents: 900 });
		for (const bad of [
			{ monthlyCapCents: 100, refill: { belowUsd: 0.5 } },
			{ monthlyCapCents: 100, refill: { belowUsd: 5, packUsd: 7 } },
			{ monthlyCapCents: -1 },
			{ monthlyCapCents: 1.5 },
			{ monthlyCapCents: "5" },
			{ refill: "on" },
			{ refill: {} },
		]) {
			const res = await post(a, "/settings", { accountId: id, ...bad });
			expect(res.status).toBe(400);
		}
		expect((await getCaps(db, id))?.monthly_cap_cents).toBe(900);
	});

	test("raising the cap through settings unfreezes like PATCH /caps", async () => {
		const id = await makeAccount();
		await upsertCaps(db, id, { monthly_cap_cents: 500, frozen_at: new Date() });
		await post(app(), "/settings", { accountId: id, monthlyCapCents: 1000 });
		expect((await getCaps(db, id))?.frozen_at).toBeNull();
	});
});

describe("parseAreas", () => {
	const ok: SentinelAreas = {
		plans: "write",
		monitoring: "read",
		alerts: "none",
	};
	test("accepts exactly the three areas", () => {
		expect(parseAreas(ok)).toEqual(ok);
	});
	test.each([
		["not an object", "read"],
		["array", []],
		["missing area", { plans: "read", monitoring: "read" }],
		["unknown area", { ...ok, billing: "read" }],
		["unknown level", { ...ok, plans: "admin" }],
	])("rejects %s", (_n, v) => {
		expect(() => parseAreas(v)).toThrow();
	});
});

describe.skipIf(!HAS_DB)("/internal/sentinel tokens + keys", () => {
	const areas = { plans: "write", monitoring: "read", alerts: "none" };
	const get = (path: string, key: string | null = KEY) =>
		app().request(`/internal/sentinel${path}`, {
			headers: key ? { authorization: `Bearer ${key}` } : {},
		});
	const del = (path: string) =>
		app().request(`/internal/sentinel${path}`, {
			method: "DELETE",
			headers: { authorization: `Bearer ${KEY}` },
		});
	const mint = async (accountId: string, name = "agent") =>
		(await (await post(app(), "/keys", { accountId, name, areas })).json()) as {
			id: string;
			key: string;
			prefix: string;
		};
	const resolve = (raw: string) =>
		post(app(), "/tokens/resolve", { tokenHash: hashToken(raw) });
	async function makeSession(
		accountId: string,
		opts: { revoked?: boolean; expiresAt?: Date } = {},
	) {
		const { raw, hash, prefix } = generateSessionToken();
		await db
			.insertInto("sessions")
			.values({
				token_hash: hash,
				token_prefix: prefix,
				account_id: accountId,
				ip_address: "test",
				...(opts.expiresAt ? { expires_at: opts.expiresAt } : {}),
				...(opts.revoked ? { revoked_at: new Date() } : {}),
			})
			.execute();
		return raw;
	}

	test("mint returns the raw key once; the stored row holds only the hash", async () => {
		const accountId = await makeAccount(`k-${randomUUID()}@example.com`);
		const res = await post(app(), "/keys", { accountId, name: "ci", areas });
		expect(res.status).toBe(201);
		const body = (await res.json()) as Record<string, unknown>;
		expect(String(body.key)).toMatch(/^sk-snt_[0-9a-f]{32}$/);
		expect(String(body.prefix)).toMatch(/^sk-snt_[0-9a-f]{8}$/);
		expect(body.areas).toEqual(areas);
		const row = await db
			.selectFrom("api_keys")
			.selectAll()
			.where("id", "=", String(body.id))
			.executeTakeFirstOrThrow();
		expect(row.key_hash).toBe(hashToken(String(body.key)));
		expect(row.key_prefix).toBe(String(body.prefix));
		expect(row.product).toBe("sentinel");
		expect(row.areas).toEqual(areas);
	});

	test("mint validates areas, name and the linked account", async () => {
		const accountId = await makeAccount(`k-${randomUUID()}@example.com`);
		for (const bad of [
			undefined,
			{ plans: "write" },
			{ ...areas, extra: "read" },
			{ ...areas, plans: "owner" },
		]) {
			expect(
				(await post(app(), "/keys", { accountId, name: "x", areas: bad }))
					.status,
			).toBe(400);
		}
		expect((await post(app(), "/keys", { accountId, areas })).status).toBe(400);
		const unlinked = await makeAccount(`k-${randomUUID()}@example.com`, false);
		expect(
			(await post(app(), "/keys", { accountId: unlinked, name: "x", areas }))
				.status,
		).toBe(403);
	});

	test("list is scoped to the account and never returns raw key or hash", async () => {
		const a = await makeAccount(`k-${randomUUID()}@example.com`);
		const b = await makeAccount(`k-${randomUUID()}@example.com`);
		const ka = await mint(a, "mine");
		await mint(b, "theirs");
		const res = await get(`/keys?accountId=${a}`);
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).not.toContain(ka.key);
		expect(text).not.toContain("key_hash");
		const { keys } = JSON.parse(text) as {
			keys: { id: string; name: string; prefix: string; areas: unknown }[];
		};
		expect(keys.map((k) => k.name)).toEqual(["mine"]);
		expect(keys[0]?.prefix).toBe(ka.prefix);
		expect(keys[0]?.areas).toEqual(areas);
	});

	test("delete revokes within the account only", async () => {
		const a = await makeAccount(`k-${randomUUID()}@example.com`);
		const b = await makeAccount(`k-${randomUUID()}@example.com`);
		const ka = await mint(a);
		expect((await del(`/keys/${ka.id}?accountId=${b}`)).status).toBe(404);
		expect((await resolve(ka.key)).status).toBe(200);
		expect((await del(`/keys/${ka.id}?accountId=${a}`)).status).toBe(200);
		expect((await resolve(ka.key)).status).toBe(404);
		expect((await del(`/keys/${ka.id}?accountId=${a}`)).status).toBe(404);
		expect((await del(`/keys/not-a-uuid?accountId=${a}`)).status).toBe(404);
	});

	test("resolve: sentinel key → kind key with areas; session → kind session", async () => {
		const accountId = await makeAccount(`k-${randomUUID()}@example.com`);
		const k = await mint(accountId);
		const res = await resolve(k.key);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			accountId,
			kind: "key",
			keyId: k.id,
			areas,
		});
		const session = await makeSession(accountId);
		const sres = await resolve(session);
		expect(sres.status).toBe(200);
		expect(await sres.json()).toEqual({ accountId, kind: "session" });
	});

	test("resolve: expired and revoked sessions, unknown hashes → 404", async () => {
		const accountId = await makeAccount(`k-${randomUUID()}@example.com`);
		const expired = await makeSession(accountId, {
			expiresAt: new Date(Date.now() - 1000),
		});
		const revoked = await makeSession(accountId, { revoked: true });
		expect((await resolve(expired)).status).toBe(404);
		expect((await resolve(revoked)).status).toBe(404);
		expect((await resolve(`sk-sl_${randomUUID()}`)).status).toBe(404);
	});

	async function insertKey(
		accountId: string,
		raw: string,
		product: "account" | "sentinel",
		status: "active" | "revoked" = "active",
	) {
		await db
			.insertInto("api_keys")
			.values({
				key_hash: hashToken(raw),
				key_prefix: raw.slice(0, 14),
				account_id: accountId,
				ip_address: "test",
				product,
				status,
				tier: "free",
				...(product === "sentinel" ? { areas } : {}),
			})
			.execute();
	}

	test("resolve: an active account key → 404 other_product, never resolved", async () => {
		const accountId = await makeAccount(`k-${randomUUID()}@example.com`);
		const raw = `sk-sl_acct_${randomUUID()}`;
		await insertKey(accountId, raw, "account");
		const res = await resolve(raw);
		expect(res.status).toBe(404);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toEqual({ error: "other_product" });
		expect(body.accountId).toBeUndefined();
	});

	test("resolve: revoked keys of any product → plain 404", async () => {
		const accountId = await makeAccount(`k-${randomUUID()}@example.com`);
		for (const product of ["account", "sentinel"] as const) {
			const raw = `sk-sl_rev_${randomUUID()}`;
			await insertKey(accountId, raw, product, "revoked");
			const res = await resolve(raw);
			expect(res.status).toBe(404);
			expect(((await res.json()) as { error?: string }).error).not.toBe(
				"other_product",
			);
		}
	});

	test("resolve: an existing sk-sl_ sentinel key still resolves", async () => {
		const accountId = await makeAccount(`k-${randomUUID()}@example.com`);
		const raw = `sk-sl_${randomUUID().replace(/-/g, "")}`;
		await insertKey(accountId, raw, "sentinel");
		const res = await resolve(raw);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ accountId, kind: "key", areas });
	});

	test("resolve rejects a non-hash (raw token) body", async () => {
		const accountId = await makeAccount(`k-${randomUUID()}@example.com`);
		const k = await mint(accountId);
		expect(
			(await post(app(), "/tokens/resolve", { tokenHash: k.key })).status,
		).toBe(400);
	});

	test("GET/DELETE keys require the service key", async () => {
		expect((await get("/keys?accountId=x", null)).status).toBe(401);
		expect((await get("/keys?accountId=x", "nope")).status).toBe(401);
	});
});
