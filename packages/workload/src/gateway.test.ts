import { describe, expect, test } from "bun:test";
import {
	DEFAULT_CODE_BY_STATUS,
	type FailedRequestRecord,
} from "@secondlayer/shared/error-envelope";
import {
	type GatewayDeps,
	classifyRequest,
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

describe("classifyRequest", () => {
	test("GET is a read", () => {
		expect(classifyRequest("GET", "/api/webhooks")).toBe("read");
	});
	test("POST .../test is a test", () => {
		expect(classifyRequest("POST", "/api/webhooks/wh_1/test")).toBe("test");
	});
	test("POST .../replay is a replay", () => {
		expect(classifyRequest("POST", "/api/webhooks/wh_1/replay")).toBe("replay");
	});
	test("POST otherwise is a write", () => {
		expect(classifyRequest("POST", "/api/webhooks")).toBe("write");
	});
	test("subgraph paths get the same buckets", () => {
		expect(classifyRequest("GET", "/v1/subgraphs/s/t")).toBe("read");
		expect(classifyRequest("HEAD", "/api/subgraphs")).toBe("read");
		expect(classifyRequest("POST", "/api/subgraphs")).toBe("write");
		expect(classifyRequest("DELETE", "/api/subgraphs/s")).toBe("write");
	});
});

describe("GET /healthz", () => {
	test("returns 200 with the injected sha and needs no API key", async () => {
		const sha = "c".repeat(40);
		const res = await handleGatewayRequest(
			baseDeps({ sha }),
			req({ path: "/healthz" }),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok", sha, busy: false });
	});

	test("an unknown sha is reported as null", async () => {
		const res = await handleGatewayRequest(
			baseDeps({ sha: null }),
			req({ path: "/healthz" }),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok", sha: null, busy: false });
	});
});

describe("GET /healthz busy", () => {
	test("reports busy from isBusy()", async () => {
		let busy = true;
		const deps = baseDeps({ isBusy: () => busy });
		const first = await handleGatewayRequest(deps, req({ path: "/healthz" }));
		expect(((await first.json()) as { busy: boolean }).busy).toBe(true);
		busy = false;
		const second = await handleGatewayRequest(deps, req({ path: "/healthz" }));
		expect(((await second.json()) as { busy: boolean }).busy).toBe(false);
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

	test.each(["/api/subgraphs", "/v1/subgraphs", "/api/subgraphs/"])(
		"no tenant yet, subgraph list read %s → 200 empty, never provisions",
		async (path) => {
			let provisionCalls = 0;
			const deps = baseDeps({
				resolveTenant: async () => undefined,
				startProvisioning: () => {
					provisionCalls++;
				},
			});
			const res = await handleGatewayRequest(
				deps,
				req({ method: "GET", path, auth: "Bearer sk-sl_good" }),
			);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ data: [] });
			expect(provisionCalls).toBe(0);
		},
	);

	test.each([
		"/api/subgraphs/my-subgraph",
		"/v1/subgraphs/my-subgraph/transfers",
		"/api/subgraphs/my-subgraph/gaps",
	])(
		"no tenant yet, subgraph read %s → 404 Subgraph not found, never provisions",
		async (path) => {
			let provisionCalls = 0;
			const deps = baseDeps({
				resolveTenant: async () => undefined,
				startProvisioning: () => {
					provisionCalls++;
				},
			});
			const res = await handleGatewayRequest(
				deps,
				req({ method: "GET", path, auth: "Bearer sk-sl_good" }),
			);
			expect(res.status).toBe(404);
			expect(((await res.json()) as { error: string }).error).toBe(
				"Subgraph not found",
			);
			expect(provisionCalls).toBe(0);
		},
	);

	test("no tenant yet, a subgraph deploy (write) provisions and 503s", async () => {
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
				path: "/api/subgraphs",
				auth: "Bearer sk-sl_good",
			}),
		);
		expect(res.status).toBe(503);
		expect(res.headers.get("Retry-After")).toBe("30");
		expect(provisionCalls).toBe(1);
	});

	test("running tenant: a subgraph read is forwarded with the path and query intact", async () => {
		let forwarded: { url: string; auth: string | null } | undefined;
		const deps = baseDeps({
			fetchImpl: async (input, init) => {
				forwarded = {
					url: String(input),
					auth: new Headers(init?.headers).get("authorization"),
				};
				return new Response("{}", { status: 200 });
			},
		});
		const res = await handleGatewayRequest(
			deps,
			new Request("https://gateway.internal/v1/subgraphs/s/t?limit=5", {
				headers: { authorization: "Bearer sk-sl_good" },
			}),
		);
		expect(res.status).toBe(200);
		expect(forwarded?.url).toBe(
			"http://127.0.0.1:20001/v1/subgraphs/s/t?limit=5",
		);
		expect(forwarded?.auth).toBe("Bearer tenant-instance-token");
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

type EnvelopeBody = {
	error: string;
	hint?: string;
	top_up_url?: string;
	code: string;
	request_id: string;
	feedback: { url: string };
};

describe("error envelope", () => {
	const GOOD = "Bearer sk-sl_good";

	function gw(overrides: Partial<GatewayDeps> = {}): {
		deps: GatewayDeps;
		rows: FailedRequestRecord[];
	} {
		const rows: FailedRequestRecord[] = [];
		return {
			rows,
			deps: baseDeps({ recordFailure: (r) => rows.push(r), ...overrides }),
		};
	}

	function call(
		deps: GatewayDeps,
		opts: { path?: string; headers?: Record<string, string> } = {},
	) {
		return handleGatewayRequest(
			deps,
			new Request(
				`https://gateway.internal${opts.path ?? "/v1/subgraphs/s/t"}`,
				{ headers: { authorization: GOOD, ...opts.headers } },
			),
		);
	}

	function jsonRes(body: unknown, status: number): Response {
		return new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	}

	test("missing bearer: enveloped, header matches body, not recorded", async () => {
		const { deps, rows } = gw();
		const res = await handleGatewayRequest(deps, req());
		const body = (await res.json()) as EnvelopeBody;
		expect(res.status).toBe(401);
		expect(body.error).toBe("missing_api_key");
		expect(body.hint).toBeString();
		expect(body.code).toBe(DEFAULT_CODE_BY_STATUS[401]);
		expect(body.request_id).toBe(res.headers.get("x-request-id") as string);
		expect(body.feedback.url).toBe("/v1/feedback");
		expect(rows).toHaveLength(0);
	});

	test("402 is enveloped and recorded", async () => {
		const { deps, rows } = gw({
			introspect: new IntrospectClient({
				appServerUrl: "https://api.secondlayer.tools",
				workloadHostKey: "wh-key",
				fetchImpl: async () =>
					jsonRes({ account_id: "acct_1", credits_ok: false }, 200),
			}),
		});
		const res = await call(deps);
		const body = (await res.json()) as EnvelopeBody;
		expect(res.status).toBe(402);
		expect(body.top_up_url).toBeString();
		expect(body.code).toBe(DEFAULT_CODE_BY_STATUS[402]);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.account_id).toBe("acct_1");
		expect(rows[0]?.code).toBe(DEFAULT_CODE_BY_STATUS[402]);
	});

	test("429 is enveloped, keeps Retry-After, not recorded", async () => {
		const { deps, rows } = gw({
			rateLimit: () => ({ allowed: false, retryAfterSeconds: 7 }),
		});
		const res = await call(deps);
		const body = (await res.json()) as EnvelopeBody;
		expect(res.status).toBe(429);
		expect(res.headers.get("retry-after")).toBe("7");
		expect(body.request_id).toBe(res.headers.get("x-request-id") as string);
		expect(rows).toHaveLength(0);
	});

	test("upstream JSON error keeps its code, feedback pointer is replaced, row recorded", async () => {
		const { deps, rows } = gw({
			fetchImpl: async () =>
				jsonRes(
					{
						error: "Unknown column: foo",
						code: "INVALID_COLUMN",
						feedback: { url: "https://github.com/x/y/issues/new" },
					},
					400,
				),
		});
		const res = await call(deps, {
			path: "/v1/subgraphs/s/t?where=foo&api_key=secret",
		});
		const body = (await res.json()) as EnvelopeBody;
		expect(body.code).toBe("INVALID_COLUMN");
		expect(body.feedback.url).toBe("/v1/feedback");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			request_id: body.request_id,
			code: "INVALID_COLUMN",
			path: "/v1/subgraphs/s/t",
			status: 400,
			method: "GET",
			query: { where: "foo" },
			message: "Unknown column: foo",
		});
	});

	test("long upstream message is truncated to 200 in the record", async () => {
		const { deps, rows } = gw({
			fetchImpl: async () => jsonRes({ error: "e".repeat(500) }, 400),
		});
		await call(deps);
		expect(rows[0]?.message).toHaveLength(200);
	});

	test("request id is forwarded upstream and matches the response", async () => {
		let seen: string | null = null;
		const { deps } = gw({
			fetchImpl: async (_url, init) => {
				seen = new Headers(init?.headers).get("x-request-id");
				return new Response("ok", { status: 200 });
			},
		});
		const res = await call(deps);
		expect(seen as string | null).toBe(res.headers.get("x-request-id"));
		expect(seen as string | null).toStartWith("req_");
	});

	test("a valid incoming request id is reused end to end; an invalid one is replaced", async () => {
		let seen: string | null = null;
		const { deps } = gw({
			fetchImpl: async (_url, init) => {
				seen = new Headers(init?.headers).get("x-request-id");
				return new Response("ok", { status: 200 });
			},
		});
		const kept = await call(deps, {
			headers: { "x-request-id": "agent-turn-123" },
		});
		expect(kept.headers.get("x-request-id")).toBe("agent-turn-123");
		expect(seen as string | null).toBe("agent-turn-123");
		const replaced = await call(deps, { headers: { "x-request-id": "<x>" } });
		expect(replaced.headers.get("x-request-id")).toStartWith("req_");
	});

	test("success bodies are untouched and carry the request id", async () => {
		const raw = '{"data":[1,2,3],"error":null}';
		const { deps, rows } = gw({
			fetchImpl: async () =>
				new Response(raw, {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		});
		const res = await call(deps);
		expect(await res.text()).toBe(raw);
		expect(res.headers.get("x-request-id")).toStartWith("req_");
		expect(rows).toHaveLength(0);
	});

	test("non-JSON upstream error passes through and is recorded with defaults", async () => {
		const { deps, rows } = gw({
			fetchImpl: async () =>
				new Response("boom", {
					status: 500,
					headers: { "content-type": "text/plain" },
				}),
		});
		const res = await call(deps);
		expect(await res.text()).toBe("boom");
		expect(res.headers.get("x-request-id")).toStartWith("req_");
		expect(rows[0]).toMatchObject({
			code: DEFAULT_CODE_BY_STATUS[500],
			message: "",
		});
	});

	test("upstream failure is a recorded, enveloped 502", async () => {
		const { deps, rows } = gw({
			fetchImpl: async () => {
				throw new Error("refused");
			},
		});
		const res = await call(deps);
		const body = (await res.json()) as EnvelopeBody;
		expect(res.status).toBe(502);
		expect(body.error).toBe("upstream_unavailable");
		expect(body.feedback.url).toBe("/v1/feedback");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe(502);
	});

	test("a throwing recorder does not change the response", async () => {
		const { deps } = gw({
			fetchImpl: async () => jsonRes({ error: "bad" }, 400),
			recordFailure: () => {
				throw new Error("recorder down");
			},
		});
		const res = await call(deps);
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toBe("bad");
	});

	test("x-sl-origin is recorded only when known", async () => {
		const { deps, rows } = gw({
			fetchImpl: async () => jsonRes({ error: "bad" }, 400),
		});
		await call(deps, { headers: { "x-sl-origin": "MCP" } });
		await call(deps, { headers: { "x-sl-origin": "evil" } });
		expect(rows.map((r) => r.origin)).toEqual(["mcp", null]);
	});
});
