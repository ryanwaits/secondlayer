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
		startTenant: () => {},
		tenantUpstream: async () => ({
			baseUrl: "http://127.0.0.1:20001",
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
		const body = (await res.json()) as { error: string; top_up_url: string };
		expect(body.error).toBe("insufficient_credits");
		expect(body.top_up_url).toBe(
			"https://www.secondlayer.tools/account/credits",
		);
		expect(resolveTenantCalled).toBe(false);
	});

	test("no tenant yet → 503 + Retry-After, kicks off provisioning exactly once (write)", async () => {
		let provisionCalls = 0;
		const deps = baseDeps({
			resolveTenant: async () => undefined,
			startProvisioning: () => {
				provisionCalls++;
			},
		});
		const res = await handleGatewayRequest(
			deps,
			req({ method: "POST", auth: "Bearer sk-sl_good" }),
		);
		expect(res.status).toBe(503);
		expect(res.headers.get("Retry-After")).toBe("30");
		expect(provisionCalls).toBe(1);
	});

	test("no tenant yet, list read → 200 empty, never provisions", async () => {
		let provisionCalls = 0;
		const deps = baseDeps({
			resolveTenant: async () => undefined,
			startProvisioning: () => {
				provisionCalls++;
			},
		});
		const res = await handleGatewayRequest(
			deps,
			req({ method: "GET", path: "/api/webhooks", auth: "Bearer sk-sl_good" }),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ data: [] });
		expect(provisionCalls).toBe(0);
	});

	test("no tenant yet, a webhook detail read → 404, never provisions", async () => {
		let provisionCalls = 0;
		const deps = baseDeps({
			resolveTenant: async () => undefined,
			startProvisioning: () => {
				provisionCalls++;
			},
		});
		const res = await handleGatewayRequest(
			deps,
			req({
				method: "GET",
				path: "/api/webhooks/wh_1",
				auth: "Bearer sk-sl_good",
			}),
		);
		expect(res.status).toBe(404);
		expect(((await res.json()) as { error: string }).error).toBe(
			"Webhook not found",
		);
		expect(provisionCalls).toBe(0);
	});

	test("no tenant yet, a deliveries read → 404, never provisions", async () => {
		let provisionCalls = 0;
		const deps = baseDeps({
			resolveTenant: async () => undefined,
			startProvisioning: () => {
				provisionCalls++;
			},
		});
		const res = await handleGatewayRequest(
			deps,
			req({
				method: "GET",
				path: "/api/webhooks/wh_1/deliveries",
				auth: "Bearer sk-sl_good",
			}),
		);
		expect(res.status).toBe(404);
		expect(provisionCalls).toBe(0);
	});

	test("no tenant yet, a write still provisions and 503s", async () => {
		let provisionCalls = 0;
		const deps = baseDeps({
			resolveTenant: async () => undefined,
			startProvisioning: () => {
				provisionCalls++;
			},
		});
		const res = await handleGatewayRequest(
			deps,
			req({
				method: "POST",
				path: "/api/webhooks/wh_1/pause",
				auth: "Bearer sk-sl_good",
			}),
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

	test("stopped tenant + creditsOk (topped up) → 503 starting, kicks a background start (review fix 3b)", async () => {
		let startCalls = 0;
		const deps = baseDeps({
			resolveTenant: async () => "stopped",
			startTenant: () => {
				startCalls++;
			},
		});
		const res = await handleGatewayRequest(
			deps,
			req({ auth: "Bearer sk-sl_good" }),
		);
		expect(res.status).toBe(503);
		expect(res.headers.get("Retry-After")).toBe("30");
		expect((await res.json()) as { error: string }).toEqual(
			expect.objectContaining({ error: "starting" }),
		);
		expect(startCalls).toBe(1);
	});

	test("stopped tenant never reaches here with creditsOk:false — that 402s earlier from introspect", async () => {
		// Documents the invariant handleGatewayRequest relies on: by the time
		// state === "stopped" is checked, introspected.creditsOk is already
		// true (the creditsOk:false branch returns 402 before resolveTenant is
		// even called — see the "credits_ok:false" test above).
		let startCalls = 0;
		const deps = baseDeps({
			introspect: new IntrospectClient({
				appServerUrl: "https://api.secondlayer.tools",
				workloadHostKey: "wh-key",
				fetchImpl: async () =>
					new Response(
						JSON.stringify({ account_id: "acct_1", credits_ok: false }),
						{ status: 200, headers: { "content-type": "application/json" } },
					),
			}),
			resolveTenant: async () => "stopped",
			startTenant: () => {
				startCalls++;
			},
		});
		const res = await handleGatewayRequest(
			deps,
			req({ auth: "Bearer sk-sl_good" }),
		);
		expect(res.status).toBe(402);
		expect(startCalls).toBe(0);
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
		expect(seen.url).toBe("http://127.0.0.1:20001/api/webhooks?limit=10");
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
