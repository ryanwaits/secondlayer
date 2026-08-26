import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import { resolveMintProduct } from "./mint.ts";
import { CreateKeySchema } from "./routes.ts";

function productApp(caller: {
	isSession: boolean;
	apiKeyProduct?: string | null;
}) {
	const app = new Hono();
	app.onError(errorHandler);
	app.post("/api/keys", async (c) => {
		const body = await c.req.json().catch(() => ({}));
		const parsed = CreateKeySchema.parse(body);
		const product = resolveMintProduct(caller, parsed.product);
		return c.json({ product }, 201);
	});
	return app;
}

describe("POST /api/keys product (no DB)", () => {
	test("schema defaults omitted product to account", () => {
		expect(CreateKeySchema.parse({}).product).toBe("account");
		expect(CreateKeySchema.parse({ name: "ops" }).product).toBe("account");
	});

	test("API-key caller with product streams → 400", async () => {
		const res = await productApp({
			isSession: false,
			apiKeyProduct: "account",
		}).request("/api/keys", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ product: "streams" }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("account");
	});

	test("session with product streams still mints streams", async () => {
		const res = await productApp({ isSession: true }).request("/api/keys", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ product: "streams" }),
		});
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ product: "streams" });
	});
});

// Integration tests — require DATABASE_URL
const skipIf = !process.env.DATABASE_URL;

describe.skipIf(skipIf)("key management routes (integration)", () => {
	test("placeholder — requires DATABASE_URL", () => {
		expect(true).toBe(true);
	});
});
