import { describe, expect, test } from "bun:test";
import { createIndexRouter } from "./index.ts";
import { createStreamsRouter } from "./streams.ts";

type Route = { path: string; description?: string; auth?: string };

async function routesOf(router: {
	request: (path: string) => Response | Promise<Response>;
}): Promise<Route[]> {
	const res = await router.request("/");
	return ((await res.json()) as { routes: Route[] }).routes;
}

describe("discovery says what the routes do about auth and metering", () => {
	test("/v1/streams/reorgs needs a bearer but is not metered per row", async () => {
		const reorgs = (await routesOf(createStreamsRouter({}))).find(
			(r) => r.path === "/v1/streams/reorgs",
		);
		expect(reorgs?.auth).toBe("bearer required, not metered");
	});

	test("print-schema is bearer-gated like every Index read, and unmetered", async () => {
		const printSchema = (await routesOf(createIndexRouter({}))).find(
			(r) => r.path === "/v1/index/contracts/:contract_id/print-schema",
		);
		expect(printSchema?.description).toContain("Bearer required");
		expect(printSchema?.description).toContain("not metered");
		expect(printSchema?.description).not.toContain("Anon ok");
	});
});
