import { describe, expect, test } from "bun:test";
import x402Router from "../x402.ts";

describe("GET /x402/supported", () => {
	test("advertises the exact scheme on stacks:1 + the price catalog + assets", async () => {
		const res = await x402Router.request("/supported");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			x402Version: number;
			kinds: { scheme: string; network: string }[];
			catalog: Record<string, unknown>;
			assets: Record<string, unknown>;
		};
		expect(body.x402Version).toBe(2);
		expect(body.kinds[0]).toMatchObject({
			scheme: "exact",
			network: "stacks:1",
		});
		expect(body.catalog).toHaveProperty("streams");
		expect(body.catalog).toHaveProperty("index");
		expect(body.assets).toHaveProperty("sBTC");
		expect(body.assets).toHaveProperty("USDCx");
	});
});
