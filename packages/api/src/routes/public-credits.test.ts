import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import publicCreditsRouter from "./public-credits.ts";

function app(): Hono {
	const h = new Hono();
	h.route("/api/public/credits", publicCreditsRouter);
	return h;
}

describe("GET /api/public/credits/packs", () => {
	test("lists the four packs", async () => {
		const res = await app().request("/api/public/credits/packs");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { packs: number[] };
		expect(body.packs).toEqual([10, 25, 50, 100]);
	});
});

describe("POST /api/public/credits/checkout", () => {
	test("rejects a missing email", async () => {
		const res = await app().request("/api/public/credits/checkout", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ amount: 25 }),
		});
		expect(res.status).toBe(400);
	});

	test("rejects a bad pack", async () => {
		const res = await app().request("/api/public/credits/checkout", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "dev@example.com", amount: 7 }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("10, 25, 50, 100");
	});
});
