import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApiApp } from "./create-app.ts";
import { HOSTED_OPENAPI_PATHS } from "./route-manifest.ts";
import {
	HOSTED_ROUTE_FIXTURES,
	RETAINED_ROUTE_FIXTURES,
} from "./route-manifest.ts";
import { OPENAPI_SPEC, openapiSpec } from "./routes/openapi.ts";

describe("route manifest", () => {
	let prevMode: string | undefined;

	beforeEach(() => {
		prevMode = process.env.INSTANCE_MODE;
	});

	afterEach(() => {
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
	});

	test("OSS hosted routes 404", async () => {
		process.env.INSTANCE_MODE = "oss";
		const app = createApiApp("oss");
		for (const { method, path } of HOSTED_ROUTE_FIXTURES) {
			const res = await app.request(path, { method });
			expect(res.status, `${method} ${path}`).toBe(404);
			const body = (await res.json()) as { code: string };
			expect(body.code).toBe("NOT_FOUND");
		}
	});

	test("OSS retained health and discovery stay up", async () => {
		process.env.INSTANCE_MODE = "oss";
		const app = createApiApp("oss");
		const health = await app.request("/health");
		expect(health.status).toBe(200);
		const v1 = await app.request("/v1");
		expect(v1.status).toBe(200);
		const surfaces = (await v1.json()) as {
			surfaces: Array<{ name: string }>;
		};
		expect(surfaces.surfaces.map((s) => s.name)).toEqual([
			"index",
			"streams",
			"subgraphs",
		]);
		const specRes = await app.request("/v1/openapi.json");
		expect(specRes.status).toBe(200);
		const spec = (await specRes.json()) as {
			paths: Record<string, unknown>;
			"x-x402"?: unknown;
		};
		expect(spec["x-x402"]).toBeUndefined();
		for (const path of HOSTED_OPENAPI_PATHS) {
			expect(spec.paths[path], path).toBeUndefined();
		}
	});

	test("retained fixtures are listed", () => {
		expect(RETAINED_ROUTE_FIXTURES.length).toBeGreaterThan(0);
		expect(
			RETAINED_ROUTE_FIXTURES.some((r) => r.path === "/v1/openapi.json"),
		).toBe(true);
	});

	test("platform OpenAPI keeps hosted x402 paths", () => {
		const spec = openapiSpec("platform");
		expect(spec).toBe(OPENAPI_SPEC);
		for (const path of HOSTED_OPENAPI_PATHS) {
			expect(spec.paths[path], path).toBeDefined();
		}
	});

	test("OSS OpenAPI drops hosted paths", () => {
		const spec = openapiSpec("oss");
		expect(spec["x-x402"]).toBeUndefined();
		for (const path of HOSTED_OPENAPI_PATHS) {
			expect(spec.paths[path], path).toBeUndefined();
		}
		expect(spec.paths["/v1/index"]).toBeDefined();
		expect(spec.paths["/v1/subgraphs"]).toBeDefined();
	});
});
