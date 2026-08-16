import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApiApp } from "./create-app.ts";
import { HOSTED_OPENAPI_PATHS } from "./route-manifest.ts";
import {
	DELETED_ROUTE_FIXTURES,
	HOSTED_ROUTE_FIXTURES,
	RETAINED_METER_ROUTE_FIXTURES,
	RETAINED_ROUTE_FIXTURES,
	WORKLOAD_ROUTE_FIXTURES,
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

	// Gate-g Slice D removed this surface from the codebase entirely: it must
	// never resolve in ANY mode. Auth-gated prefixes (/api/accounts/*, the
	// key-mandatory /v1/streams/*) 401 in middleware before routing, so "not
	// mounted" means 401-or-404 — never a success.
	test("deleted Slice D routes are gone in both modes", async () => {
		for (const mode of ["oss", "platform"] as const) {
			process.env.INSTANCE_MODE = mode;
			const app = createApiApp(mode);
			for (const { method, path } of DELETED_ROUTE_FIXTURES) {
				const res = await app.request(path, { method });
				expect(
					[401, 404],
					`${mode} ${method} ${path} → ${res.status}`,
				).toContain(res.status);
			}
		}
	});

	// The retained meter surface is platform/archive-mode only: it must 404 in
	// oss like the hosted surface, but it is NOT a deletion candidate — the
	// separate fixture list is what deletion scans key off.
	test("OSS retained-meter routes 404 (mounted only in platform mode)", async () => {
		process.env.INSTANCE_MODE = "oss";
		const app = createApiApp("oss");
		for (const { method, path } of RETAINED_METER_ROUTE_FIXTURES) {
			const res = await app.request(path, { method });
			expect(res.status, `${method} ${path}`).toBe(404);
			const body = (await res.json()) as { code: string };
			expect(body.code).toBe("NOT_FOUND");
		}
	});

	// Workload routes (subgraphs, subscriptions, node) deploy and execute
	// customer-authored handler code and drive outbound webhook delivery. The
	// archive deployment serves data and does not run anyone's workload
	// (STRATEGY.md, "We do not host public subgraphs"), so these must 404
	// there — not 401. 404 means the route does not exist, so there is
	// nothing to authenticate against and nothing to probe.
	test("platform workload routes 404 (mounted only in oss)", async () => {
		process.env.INSTANCE_MODE = "platform";
		const app = createApiApp("platform");
		for (const { method, path } of WORKLOAD_ROUTE_FIXTURES) {
			const res = await app.request(path, { method });
			expect(res.status, `${method} ${path}`).toBe(404);
			const body = (await res.json()) as { code: string };
			expect(body.code).toBe("NOT_FOUND");
		}
	});

	// "archive" aliases "platform" (packages/shared/src/mode.ts) and the alias
	// must not drift: a declared INSTANCE_MODE=archive must resolve to the
	// same no-workload behavior as platform.
	test("archive mode behaves like platform for workload routes", async () => {
		process.env.INSTANCE_MODE = "archive";
		const app = createApiApp("platform");
		for (const { method, path } of WORKLOAD_ROUTE_FIXTURES) {
			const res = await app.request(path, { method });
			expect(res.status, `${method} ${path}`).toBe(404);
			const body = (await res.json()) as { code: string };
			expect(body.code).toBe("NOT_FOUND");
		}
		// Guard against over-deletion: /v1/subgraphs is the public read path,
		// a separate router mounted under /v1, and must keep working on the
		// archive deployment.
		const v1Res = await app.request("/v1/subgraphs");
		expect(v1Res.status).not.toBe(404);
	});

	test("oss workload routes stay mounted", async () => {
		process.env.INSTANCE_MODE = "oss";
		const app = createApiApp("oss");
		for (const { method, path } of WORKLOAD_ROUTE_FIXTURES) {
			const res = await app.request(path, { method });
			if (path === "/api/node") {
				// nodeRouter has no handler for its own root — only
				// /api/node/contracts/:id/abi — so the bare path 404s whether
				// mounted or not. That's the router's pre-existing shape, not a
				// signal about mounting, so it's asserted separately rather than
				// folded into the "not 404" check below.
				expect(res.status, `${method} ${path}`).toBe(404);
				continue;
			}
			// Real handlers respond: 200/401/405 for a route that exists, or 400
			// when a handler validates its body (e.g. the bundle route rejects an
			// empty POST) — anything but 404, which would mean unmounted.
			expect([200, 400, 401, 405], `${method} ${path}`).toContain(res.status);
		}
	});

	test("retained-meter fixtures cover the kept account surface", () => {
		const paths = RETAINED_METER_ROUTE_FIXTURES.map((r) => r.path);
		expect(paths).toContain("/api/auth/login");
		expect(paths).toContain("/api/billing/status");
		expect(paths).toContain("/api/billing/topup");
		expect(paths).toContain("/api/billing/refill");
		expect(paths).toContain("/api/billing/caps");
		expect(paths).toContain("/api/public/credits/checkout");
		expect(paths).toContain("/api/webhooks/stripe");
		expect(paths).toContain("/api/keys");
		expect(paths).toContain("/api/accounts/me");
		// Retired billing plan routes must never reappear in any fixture list.
		const all = [
			...HOSTED_ROUTE_FIXTURES,
			...RETAINED_METER_ROUTE_FIXTURES,
			...RETAINED_ROUTE_FIXTURES,
			...WORKLOAD_ROUTE_FIXTURES,
		].map((r) => r.path);
		for (const dead of [
			"/api/billing/upgrade",
			"/api/billing/resolve",
			"/api/billing/cancel",
			"/api/billing/portal",
		]) {
			expect(all).not.toContain(dead);
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
			"instance",
		]);
		const features = await app.request("/v1/instance/features");
		expect(features.status).toBe(200);
		const featureBody = (await features.json()) as {
			features: { signup: boolean; pricing: boolean };
		};
		expect(featureBody.features.signup).toBe(false);
		expect(featureBody.features.pricing).toBe(false);
		const consolePage = await app.request("/console");
		expect(consolePage.status).toBe(200);
		expect(await consolePage.text()).toContain("No signup");
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

	test("platform OpenAPI is the unfiltered spec", () => {
		expect(openapiSpec("platform")).toBe(OPENAPI_SPEC);
	});

	test("OSS OpenAPI drops hosted paths and keeps the public surface", () => {
		const spec = openapiSpec("oss");
		for (const path of HOSTED_OPENAPI_PATHS) {
			expect(spec.paths[path], path).toBeUndefined();
		}
		expect(spec.paths["/v1/index"]).toBeDefined();
		expect(spec.paths["/v1/subgraphs"]).toBeDefined();
	});

	/**
	 * The x402 rail was deleted, not gated. These loops would pass vacuously
	 * against the now-empty HOSTED_OPENAPI_PATHS, so name the paths directly —
	 * a reintroduction has to fail a test, not slip through an empty list.
	 */
	test("the deleted x402 surface is absent from BOTH modes", () => {
		const x402Paths = [
			"/v1/x402/supported",
			"/v1/x402/deposit",
			"/v1/x402/balance",
			"/v1/subgraphs/deploy-paid",
		];
		for (const mode of ["platform", "oss"] as const) {
			const spec = openapiSpec(mode) as unknown as {
				paths: Record<string, unknown>;
				"x-x402"?: unknown;
			};
			expect(spec["x-x402"], mode).toBeUndefined();
			for (const path of x402Paths) {
				expect(spec.paths[path], `${mode} ${path}`).toBeUndefined();
			}
		}
	});
});
