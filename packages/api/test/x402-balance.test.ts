import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { errorHandler } from "../src/middleware/error.ts";
import { createX402Router } from "../src/routes/x402.ts";
import {
	creditBalance,
	debitBalance,
	getBalance,
	mintBalanceToken,
	usdToMicros,
	verifyBalanceToken,
} from "../src/x402/balance.ts";

const SKIP = !process.env.DATABASE_URL;
const SECRET = "balance-test-secret";
const PAYER = `SP${crypto.randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`;

describe.skipIf(SKIP)("x402 prepaid balances", () => {
	afterAll(async () => {
		await getDb()
			.deleteFrom("x402_balances")
			.where("principal", "=", PAYER)
			.execute();
		delete process.env.SECONDLAYER_SECRETS_KEY;
	});

	test("credit accumulates; debit is atomic with a floor", async () => {
		const db = getDb();
		expect(await getBalance(db, PAYER)).toBe(0n);
		await creditBalance(db, PAYER, usdToMicros(1));
		const after = await creditBalance(db, PAYER, usdToMicros(0.5));
		expect(after).toBe(usdToMicros(1.5));

		const ok = await debitBalance(db, PAYER, usdToMicros(0.001));
		expect(ok.ok).toBe(true);
		expect(ok.remaining).toBe(usdToMicros(1.499));

		const tooBig = await debitBalance(db, PAYER, usdToMicros(10));
		expect(tooBig.ok).toBe(false);
		expect(await getBalance(db, PAYER)).toBe(usdToMicros(1.499));
	});

	test("balance token mints and verifies; wrong surface rejected", () => {
		const token = mintBalanceToken(PAYER, SECRET);
		expect(verifyBalanceToken(token, SECRET)).toBe(PAYER);
		expect(verifyBalanceToken(token, "other")).toBeNull();
		expect(verifyBalanceToken("garbage", SECRET)).toBeNull();
	});

	test("deposit route credits the settled amount and returns a token", async () => {
		process.env.SECONDLAYER_SECRETS_KEY = SECRET;
		const app = new Hono();
		app.onError(errorHandler);
		// fake deposit middleware: pretend a $5 payment settled for PAYER
		const fakeMw = (async (
			// biome-ignore lint/suspicious/noExplicitAny: test stub
			c: any,
			next: () => Promise<void>,
		) => {
			c.set("x402Payer", PAYER);
			c.set("x402PaidUsd", 5);
			await next();
			// biome-ignore lint/suspicious/noExplicitAny: matches middleware type
		}) as any;
		app.route("/v1/x402", createX402Router({ depositMiddleware: fakeMw }));

		const before = await getBalance(getDb(), PAYER);
		const res = await app.request("/v1/x402/deposit?usd=5", {
			method: "POST",
		});
		expect(res.status).toBe(200);
		// biome-ignore lint/suspicious/noExplicitAny: test response shape
		const body = (await res.json()) as any;
		expect(body.credited_usd).toBe(5);
		expect(usdToMicros(body.balance_usd)).toBe(before + usdToMicros(5));
		expect(typeof body.balance_token).toBe("string");

		// balance endpoint answers with that token
		const bal = await app.request("/v1/x402/balance", {
			headers: { "PAYMENT-BALANCE": body.balance_token },
		});
		expect(bal.status).toBe(200);
		// biome-ignore lint/suspicious/noExplicitAny: test response shape
		const balBody = (await bal.json()) as any;
		expect(balBody.principal).toBe(PAYER);
		expect(usdToMicros(balBody.balance_usd)).toBe(before + usdToMicros(5));

		// no token → 401
		expect((await app.request("/v1/x402/balance")).status).toBe(401);
	});
});
