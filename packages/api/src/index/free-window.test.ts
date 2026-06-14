import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import type { IndexEnv } from "./auth.ts";
import { INDEX_FREE_WINDOW_BLOCKS, indexFreeWindow } from "./free-window.ts";
import type { IndexTip } from "./tip.ts";

const TIP_HEIGHT = 1_000_000;
const TIP: IndexTip = {
	block_height: TIP_HEIGHT,
	finalized_height: TIP_HEIGHT,
	lag_seconds: 0,
};
const CUTOFF = TIP_HEIGHT - INDEX_FREE_WINDOW_BLOCKS;

/** Mount the gate behind an optional tier/x402/credited seed, with a stub /events route. */
function app(seed?: { tier?: string; x402Payer?: string; credited?: boolean }) {
	const a = new Hono<IndexEnv>();
	a.onError(errorHandler);
	a.use("*", async (c, next) => {
		if (seed?.tier) {
			c.set("indexTenant", {
				tenant_id: "t",
				tier: seed.tier as never,
				scopes: [],
			});
		}
		if (seed?.x402Payer) c.set("x402Payer" as never, seed.x402Payer as never);
		if (seed?.credited)
			c.set("credited", { accountId: "acct", balance: 10_000n });
		await next();
	});
	a.use("*", indexFreeWindow({ getTip: async () => TIP }));
	a.get("/events", (c) => c.json({ ok: true }));
	return a;
}

describe("indexFreeWindow", () => {
	// The gate is platform-only (self-host has no free tier / window).
	let prevMode: string | undefined;
	beforeAll(() => {
		prevMode = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "platform";
	});
	afterAll(() => {
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
	});

	test("oss/self-host: deep read passes (no free window)", async () => {
		process.env.INSTANCE_MODE = "oss";
		const res = await app().request(`/events?from_height=1`);
		expect(res.status).toBe(200);
		process.env.INSTANCE_MODE = "platform";
	});

	test("free: cursor-less read passes (route serves its default 24h window)", async () => {
		const res = await app({ tier: "free" }).request("/events");
		expect(res.status).toBe(200);
	});

	test("anon: recent from_height inside the window passes", async () => {
		const res = await app().request(`/events?from_height=${CUTOFF + 100}`);
		expect(res.status).toBe(200);
	});

	test("anon: from_height below the window → 402 UPGRADE_REQUIRED", async () => {
		const res = await app().request(`/events?from_height=${CUTOFF - 1}`);
		expect(res.status).toBe(402);
		const body = (await res.json()) as { details?: { reason?: string } };
		expect(body.details?.reason).toBe("UPGRADE_REQUIRED");
	});

	test("free: deep cursor → 402", async () => {
		const res = await app({ tier: "free" }).request(
			`/events?cursor=${CUTOFF - 5000}:0`,
		);
		expect(res.status).toBe(402);
	});

	test("credited free account: deep read passes (pay-as-you-go)", async () => {
		const res = await app({ tier: "free", credited: true }).request(
			`/events?from_height=1`,
		);
		expect(res.status).toBe(200);
	});

	test("paid tier (build): deep from_height passes", async () => {
		const res = await app({ tier: "build" }).request("/events?from_height=1");
		expect(res.status).toBe(200);
	});

	test("x402-paid caller: deep from_height passes", async () => {
		const res = await app({ x402Payer: "SP123" }).request(
			"/events?from_height=1",
		);
		expect(res.status).toBe(200);
	});

	test("malformed from_height falls through (route validates → not 402)", async () => {
		const res = await app().request("/events?from_height=notanumber");
		expect(res.status).toBe(200);
	});
});
