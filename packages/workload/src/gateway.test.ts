import { describe, expect, test } from "bun:test";
import {
	type GatewayDeps,
	classifyWebhooksRequest,
	handleGatewayRequest,
} from "./gateway.ts";
import { IntrospectClient } from "./introspect-client.ts";

function baseDeps(overrides: Partial<GatewayDeps> = {}): GatewayDeps {
	return {
		introspect: new IntrospectClient({
			appServerUrl: "https://api.secondlayer.tools",
			workloadHostKey: "wh-key",
			fetchImpl: async () =>
				new Response(
					JSON.stringify({ account_id: "acct_1", credits_ok: true }),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				),
		}),
		resolveTenant: async () => "running",
		startProvisioning: () => {},
		tenantUpstream: async () => ({
			baseUrl: "http://tenant-acct1234-api:3800",
			instanceToken: "tenant-instance-token",
		}),
		fetchImpl: async () => new Response("ok", { status: 200 }),
		...overrides,
	};
}

function req(
	opts: { method?: string; path?: string; auth?: string } = {},
): Request {
	return new Request(
		`https://gateway.internal${opts.path ?? "/api/webhooks"}`,
		{
			method: opts.method ?? "GET",
			headers: opts.auth ? { authorization: opts.auth } : {},
		},
	);
}

describe("classifyWebhooksRequest", () => {
	test("GET is a read", () => {
		expect(classifyWebhooksRequest("GET", "/api/webhooks")).toBe("read");
	});
	test("POST .../test is a test", () => {
		expect(classifyWebhooksRequest("POST", "/api/webhooks/wh_1/test")).toBe(
			"test",
		);
	});
	test("POST .../replay is a replay", () => {
		expect(classifyWebhooksRequest("POST", "/api/webhooks/wh_1/replay")).toBe(
			"replay",
		);
	});
	test("POST otherwise is a write", () => {
		expect(classifyWebhooksRequest("POST", "/api/webhooks")).toBe("write");
	});
});

describe("handleGatewayRequest", () => {
	test("no Authorization header → 401 missing_api_key", async () => {
		const res = await handleGatewayRequest(baseDeps(), req());
		expect(res.status).toBe(401);
		expect(((await res.json()) as { error: string }).error).toBe(
			"missing_api_key",
		);
	});

	test("an invalid key → 401 invalid_api_key, upstream never called", async () => {
		let upstreamCalled = false;
		const deps = baseDeps({
			introspect: new IntrospectClient({
				appServerUrl: "https://api.secondlayer.tools",
				workloadHostKey: "wh-key",
				fetchImpl: async () => new Response("{}", { status: 401 }),
			}),
			fetchImpl: async () => {
				upstreamCalled = true;
				return new Response("ok");
			},
		});
		const res = await handleGatewayRequest(
			deps,
			req({ auth: "Bearer sk-sl_bad" }),
		);
		expect(res.status).toBe(401);
		expect(upstreamCalled).toBe(false);
	});

	test("credits_ok:false → 402 insufficient_credits before touching the tenant", async () => {
		let resolveTenantCalled = false;
		const deps = baseDeps({
			introspect: new IntrospectClient({
				appServerUrl: "https://api.secondlayer.tools",
				workloadHostKey: "wh-key",
				fetchImpl: async () =>
					new Response(
						JSON.stringify({ account_id: "acct_1", credits_ok: false }),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					),
			}),
			resolveTenant: async () => {
				resolveTenantCalled = true;
				return "running";
			},
		});
		const res = await handleGatewayRequest(
			deps,
			req({ auth: "Bearer sk-sl_good" }),
		);
		expect(res.status).toBe(402);
		expect(((await res.json()) as { error: string }).error).toBe(
			"insufficient_credits",
		);
		expect(resolveTenantCalled).toBe(false);
	});

	test("no tenant yet → 503 + Retry-After, kicks off provisioning exactly once", async () => {
		let provisionCalls = 0;
		const deps = baseDeps({
			resolveTenant: async () => undefined,
			startProvisioning: () => {
				provisionCalls++;
			},
		});
		const res = await handleGatewayRequest(
			deps,
			req({ auth: "Bearer sk-sl_good" }),
		);
		expect(res.status).toBe(503);
		expect(res.headers.get("Retry-After")).toBe("30");
		expect(provisionCalls).toBe(1);
	});

	test("tenant mid-provisioning → 503 + Retry-After, no duplicate provisioning", async () => {
		let provisionCalls = 0;
		const deps = baseDeps({
			resolveTenant: async () => "provisioning",
			startProvisioning: () => {
				provisionCalls++;
			},
		});
		const res = await handleGatewayRequest(
			deps,
			req({ auth: "Bearer sk-sl_good" }),
		);
		expect(res.status).toBe(503);
		expect(res.headers.get("Retry-After")).toBe("30");
		expect(provisionCalls).toBe(0);
	});

	test("stopped tenant (zero balance) → 402 insufficient_credits", async () => {
		const deps = baseDeps({ resolveTenant: async () => "stopped" });
		const res = await handleGatewayRequest(
			deps,
			req({ auth: "Bearer sk-sl_good" }),
		);
		expect(res.status).toBe(402);
	});

	test("destroyed tenant → 401 invalid_api_key", async () => {
		const deps = baseDeps({ resolveTenant: async () => "destroyed" });
		const res = await handleGatewayRequest(
			deps,
			req({ auth: "Bearer sk-sl_good" }),
		);
		expect(res.status).toBe(401);
	});

	test("running tenant: forwards with the stack's own INSTANCE_TOKEN, never the customer key", async () => {
		const seen: { auth: string | null; url: string } = { auth: null, url: "" };
		const deps = baseDeps({
			fetchImpl: async (url, init) => {
				seen.url = String(url);
				seen.auth = (init?.headers as Headers).get("authorization");
				return new Response("upstream-body", { status: 200 });
			},
		});
		const res = await handleGatewayRequest(
			deps,
			req({
				auth: "Bearer sk-sl_customer_key",
				path: "/api/webhooks?limit=10",
			}),
		);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("upstream-body");
		expect(seen.auth).toBe("Bearer tenant-instance-token");
		expect(seen.url).toBe(
			"http://tenant-acct1234-api:3800/api/webhooks?limit=10",
		);
	});

	test("rate limited → 429 with Retry-After, upstream never called", async () => {
		let upstreamCalled = false;
		const deps = baseDeps({
			rateLimit: () => ({ allowed: false, retryAfterSeconds: 12 }),
			fetchImpl: async () => {
				upstreamCalled = true;
				return new Response("ok");
			},
		});
		const res = await handleGatewayRequest(
			deps,
			req({ auth: "Bearer sk-sl_good" }),
		);
		expect(res.status).toBe(429);
		expect(res.headers.get("Retry-After")).toBe("12");
		expect(upstreamCalled).toBe(false);
	});

	test("upstream network failure → 502, not a crash", async () => {
		const deps = baseDeps({
			fetchImpl: async () => {
				throw new Error("ECONNREFUSED");
			},
		});
		const res = await handleGatewayRequest(
			deps,
			req({ auth: "Bearer sk-sl_good" }),
		);
		expect(res.status).toBe(502);
	});
});
