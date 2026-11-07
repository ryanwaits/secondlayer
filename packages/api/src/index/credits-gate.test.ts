import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { meter } from "@secondlayer/platform/billing/meter";
import { ROWS_DELIVERED_MONTHLY_ALLOWANCE } from "@secondlayer/platform/billing/prices";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import type { IndexEnv } from "./auth.ts";
import { indexCreditsGate, isUnmeteredRead } from "./credits-gate.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const UNMETERED_PATHS = [
	"/v1/index/blocks",
	"/v1/index/blocks/123",
	"/v1/index/canonical",
	"/v1/index/transactions/0xabc",
	"/v1/index/transactions/0xabc/proof",
	"/v1/index/pox/cycles",
	"/v1/index/pox/cycles/90",
	"/v1/index/sbtc/summary",
	"/v1/index/sbtc/withdrawals/12",
	"/v1/index/sbtc/deposits/abcd",
	"/v1/index/runes/UNCOMMON%E2%80%A2GOODS",
	"/v1/index/mempool/0xabc",
	"/v1/index/contracts/SP123.token/print-schema",
];

const METERED_PATHS = [
	"/v1/index/events",
	"/v1/index/transactions",
	"/v1/index/ft-transfers",
	"/v1/index/runes",
	"/v1/index/runes/activity",
	"/v1/index/sbtc/deposits",
	"/v1/index/mempool",
];

describe("isUnmeteredRead", () => {
	test("reference reads are unmetered", () => {
		for (const path of UNMETERED_PATHS) {
			expect(isUnmeteredRead(path), path).toBe(true);
		}
	});

	test("row-delivering lists stay metered", () => {
		for (const path of METERED_PATHS) {
			expect(isUnmeteredRead(path), path).toBe(false);
		}
	});
});

describe.skipIf(!HAS_DB)("index credits gate past the allowance (DB)", () => {
	const db = HAS_DB ? getDb() : (null as never);
	let prevMode: string | undefined;
	let accountId: string;

	beforeAll(async () => {
		prevMode = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "platform";
		const row = await db
			.insertInto("accounts")
			.values({ email: `index-gate-${crypto.randomUUID()}@example.com` })
			.returning("id")
			.executeTakeFirstOrThrow();
		accountId = row.id;
		await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: ROWS_DELIVERED_MONTHLY_ALLOWANCE,
			source: "test-seed",
			idempotencyKey: `seed-${accountId}`,
			occurredAt: new Date(),
		});
	});
	afterAll(async () => {
		if (prevMode === undefined)
			Reflect.deleteProperty(process.env, "INSTANCE_MODE");
		else process.env.INSTANCE_MODE = prevMode;
		await db.deleteFrom("accounts").where("id", "=", accountId).execute();
	});

	function app() {
		const a = new Hono<IndexEnv>();
		a.onError(errorHandler);
		a.use("*", async (c, next) => {
			c.set("indexTenant", {
				tenant_id: `account:${accountId}`,
				account_id: accountId,
				tier: "free",
				scopes: [],
			});
			await next();
		});
		a.use("*", indexCreditsGate());
		a.get("*", (c) => c.json({ ok: true }));
		return a;
	}

	test("reference reads still return 200 with the allowance used and no balance", async () => {
		const a = app();
		for (const path of UNMETERED_PATHS) {
			const res = await a.request(path);
			expect(res.status, path).toBe(200);
		}
	});

	test("row-delivering lists return 402 with the allowance used and no balance", async () => {
		const a = app();
		for (const path of METERED_PATHS) {
			const res = await a.request(path);
			expect(res.status, path).toBe(402);
		}
	});
});
