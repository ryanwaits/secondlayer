import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { createApiApp } from "../src/create-app.ts";

/**
 * The write plane refuses requests a browser could have forged.
 *
 * A cross-origin POST only gets a CORS preflight — and so only gets stopped by
 * our CORS policy — when it is not a "simple request". Simple means a
 * Content-Type of text/plain, x-www-form-urlencoded or multipart/form-data, or
 * no Content-Type at all. Those are delivered, and `c.req.json()` parses them
 * regardless. `POST /api/subgraphs` runs deployed handler code in-process, so
 * on a tokenless instance that is code execution from any page the operator
 * visits.
 *
 * These run tokenless on a loopback bind on purpose: that is the install with
 * no other defense, so a request reaching the handler proves the guard is the
 * only thing that could have said no. Assertions are `not 415` rather than 200
 * — the handlers behind them read Postgres and fail for unrelated reasons.
 */

const JSON_CT = { "content-type": "application/json" } as const;

/** Routes where a forged write has a real effect: deploying handler code that
 *  the processor imports and runs, dropping and rebuilding a schema, and
 *  making the instance issue outbound HTTP to a caller-chosen URL. */
const DANGEROUS_WRITES = [
	["deploy a subgraph", "/api/subgraphs"],
	["reindex a subgraph", "/api/subgraphs/demo/reindex"],
	["create a subscription", "/api/subscriptions"],
	[
		"fire a test delivery",
		"/api/subscriptions/3f8c1a2e-0000-4000-8000-00000000ab01/test",
	],
] as const;

/** The three types a browser can put on a cross-origin POST without asking. */
const PREFLIGHT_FREE_TYPES: string[] = [
	"text/plain;charset=UTF-8",
	"application/x-www-form-urlencoded;charset=UTF-8",
	"multipart/form-data; boundary=----WebKitFormBoundaryXyz",
];

const prev = {
	mode: process.env.INSTANCE_MODE,
	host: process.env.LISTEN_HOST,
	publish: process.env.API_PUBLISH_ADDR,
	token: process.env.INSTANCE_TOKEN,
	apiKey: process.env.API_KEY,
};

function restore(key: string, value: string | undefined): void {
	if (value === undefined) Reflect.deleteProperty(process.env, key);
	else process.env[key] = value;
}

afterAll(() => {
	restore("INSTANCE_MODE", prev.mode);
	restore("LISTEN_HOST", prev.host);
	restore("API_PUBLISH_ADDR", prev.publish);
	restore("INSTANCE_TOKEN", prev.token);
	restore("API_KEY", prev.apiKey);
});

/** The install with no other defense: self-hosted, loopback, no token set. */
function tokenlessApp(): Hono {
	process.env.INSTANCE_MODE = "oss";
	process.env.LISTEN_HOST = "127.0.0.1";
	Reflect.deleteProperty(process.env, "API_PUBLISH_ADDR");
	Reflect.deleteProperty(process.env, "INSTANCE_TOKEN");
	Reflect.deleteProperty(process.env, "API_KEY");
	return createApiApp("oss");
}

describe("write plane content-type guard", () => {
	beforeEach(() => {
		process.env.INSTANCE_MODE = "oss";
	});

	describe("what a browser can send without a preflight", () => {
		test.each(DANGEROUS_WRITES)(
			"%s rejects a text/plain body",
			async (_name, path) => {
				const res = await tokenlessApp().request(path, {
					method: "POST",
					headers: { "content-type": "text/plain;charset=UTF-8" },
					body: JSON.stringify({ name: "demo" }),
				});
				expect(res.status).toBe(415);
			},
		);

		test.each(PREFLIGHT_FREE_TYPES)(
			"a deploy sent as %s is rejected",
			async (contentType) => {
				const res = await tokenlessApp().request("/api/subgraphs", {
					method: "POST",
					headers: { "content-type": contentType },
					body: JSON.stringify({ name: "demo" }),
				});
				expect(res.status).toBe(415);
			},
		);

		// `fetch(url, { body: new Uint8Array(...) })` sets no Content-Type at all
		// and is still a simple request — and `c.req.json()` parses those bytes
		// happily. Absent is as forgeable as text/plain when a payload rides along.
		test("a byte-array body with no content-type is rejected", async () => {
			const res = await tokenlessApp().request("/api/subgraphs", {
				method: "POST",
				body: new TextEncoder().encode(JSON.stringify({ name: "demo" })),
			});
			expect(res.status).toBe(415);
		});

		// `/subscriptions/:id/test` reads no body, so "carries a payload" cannot
		// catch it. The Origin header can: the Fetch spec requires it on every
		// request whose method is not GET/HEAD, so a browser cannot omit it.
		test("a body-less action POST carrying an Origin is rejected", async () => {
			const res = await tokenlessApp().request(
				"/api/subscriptions/3f8c1a2e-0000-4000-8000-00000000ab01/test",
				{
					method: "POST",
					headers: { origin: "https://evil.example" },
				},
			);
			expect(res.status).toBe(415);
		});
	});

	describe("what legitimate callers send", () => {
		test.each(DANGEROUS_WRITES)(
			"%s accepts application/json",
			async (_name, path) => {
				const res = await tokenlessApp().request(path, {
					method: "POST",
					headers: JSON_CT,
					body: JSON.stringify({ name: "demo" }),
				});
				expect(res.status).not.toBe(415);
			},
		);

		test("a charset parameter on application/json is accepted", async () => {
			for (const ct of [
				"application/json; charset=utf-8",
				"application/json;charset=UTF-8",
				"Application/JSON",
			]) {
				const res = await tokenlessApp().request("/api/subgraphs", {
					method: "POST",
					headers: { "content-type": ct },
					body: JSON.stringify({ name: "demo" }),
				});
				expect(res.status, ct).not.toBe(415);
			}
		});

		// The console's server-side proxy and the SDK both call action routes
		// with no body and therefore no Content-Type. Nothing about that shape is
		// browser-forgeable — no payload, no Origin — so it keeps working.
		test.each([
			["POST", "/api/subgraphs/demo/reindex"],
			["POST", "/api/subgraphs/demo/stop"],
			["POST", "/api/subscriptions/3f8c1a2e-0000-4000-8000-00000000ab01/pause"],
			[
				"POST",
				"/api/subscriptions/3f8c1a2e-0000-4000-8000-00000000ab01/rotate-secret",
			],
			["DELETE", "/api/subgraphs/demo"],
			["DELETE", "/api/subscriptions/3f8c1a2e-0000-4000-8000-00000000ab01"],
		])("a body-less server-side %s %s still passes", async (method, path) => {
			const res = await tokenlessApp().request(path, { method });
			expect(res.status).not.toBe(415);
		});
	});

	// PUT/PATCH/DELETE are not CORS-safelisted methods, so a browser always has
	// to preflight them and our CORS policy already decides. The guard still
	// checks the type when they carry one, and still lets a body-less one by.
	describe("methods the CORS preflight already gates", () => {
		test("a PATCH with a text/plain body is still rejected", async () => {
			const res = await tokenlessApp().request(
				"/api/subscriptions/3f8c1a2e-0000-4000-8000-00000000ab01",
				{
					method: "PATCH",
					headers: { "content-type": "text/plain;charset=UTF-8" },
					body: JSON.stringify({ enabled: false }),
				},
			);
			expect(res.status).toBe(415);
		});

		test("a PATCH with a JSON body passes", async () => {
			const res = await tokenlessApp().request(
				"/api/subscriptions/3f8c1a2e-0000-4000-8000-00000000ab01",
				{
					method: "PATCH",
					headers: JSON_CT,
					body: JSON.stringify({ enabled: false }),
				},
			);
			expect(res.status).not.toBe(415);
		});

		test("a DELETE with a form-urlencoded body is rejected", async () => {
			const res = await tokenlessApp().request("/api/subgraphs/demo", {
				method: "DELETE",
				headers: {
					"content-type": "application/x-www-form-urlencoded;charset=UTF-8",
				},
				body: "force=true",
			});
			expect(res.status).toBe(415);
		});
	});

	describe("reads are untouched", () => {
		test.each([
			["GET", "/api/subgraphs"],
			["HEAD", "/api/subgraphs"],
			["GET", "/v1/index/events?limit=1"],
			["GET", "/status"],
			["GET", "/health"],
		])("%s %s is not gated on content-type", async (method, path) => {
			const res = await tokenlessApp().request(path, { method });
			expect(res.status).not.toBe(415);
		});

		// A GET is a simple request whatever it claims to be, and there is no
		// body to police — refusing one would break browsers for no gain.
		test("a GET declaring text/plain is served", async () => {
			const res = await tokenlessApp().request("/api/subgraphs", {
				method: "GET",
				headers: { "content-type": "text/plain" },
			});
			expect(res.status).not.toBe(415);
		});
	});

	describe("the rejection tells the caller what to fix", () => {
		test("415 names the header, the reason, and what arrived", async () => {
			const res = await tokenlessApp().request("/api/subgraphs", {
				method: "POST",
				headers: { "content-type": "text/plain;charset=UTF-8" },
				body: "{}",
			});
			expect(res.status).toBe(415);
			const body = (await res.json()) as {
				code?: string;
				details?: { hint?: string; header?: string; received?: string | null };
			};
			expect(body.code).toBe("UNSUPPORTED_MEDIA_TYPE");
			expect(body.details?.header).toBe("Content-Type: application/json");
			expect(body.details?.received).toBe("text/plain;charset=UTF-8");
			expect(body.details?.hint).toContain("application/json");
			expect(body.details?.hint).toContain("preflight");
		});

		test("a missing content-type reports itself as missing, not guessed", async () => {
			const res = await tokenlessApp().request("/api/subgraphs", {
				method: "POST",
				body: new TextEncoder().encode("{}"),
			});
			expect(res.status).toBe(415);
			const body = (await res.json()) as {
				details?: { received?: string | null };
			};
			expect(body.details?.received).toBeNull();
		});
	});
});

describe("the Stripe webhook is exempt", () => {
	function platformApp(): Hono {
		process.env.INSTANCE_MODE = "platform";
		return createApiApp("platform");
	}

	// Stripe picks its own content type and authenticates with an HMAC over the
	// raw bytes, which is strictly stronger than any header shape. Reaching the
	// handler's own signature check (400) rather than the guard (415) is the
	// assertion: a paid event must never be dropped for its Content-Type.
	test.each([
		["no content-type at all", undefined],
		["text/plain", "text/plain;charset=UTF-8"],
		["application/json; charset=utf-8", "application/json; charset=utf-8"],
	])(
		"a webhook delivered with %s reaches the signature check",
		async (_name, contentType) => {
			const res = await platformApp().request("/api/webhooks/stripe", {
				method: "POST",
				headers: contentType ? { "content-type": contentType } : undefined,
				body: JSON.stringify({
					id: "evt_1",
					type: "checkout.session.completed",
				}),
			});
			expect(res.status).not.toBe(415);
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({
				error: "Missing stripe-signature header",
			});
		},
	);

	test("the metered write plane is still guarded around it", async () => {
		const app = platformApp();
		for (const path of [
			"/api/archive/quote",
			"/api/archive/fetch",
			"/api/billing/topup",
			"/api/public/credits/checkout",
			"/api/auth/magic-link",
		]) {
			const res = await app.request(path, {
				method: "POST",
				headers: { "content-type": "text/plain;charset=UTF-8" },
				body: JSON.stringify({ email: "a@b.co" }),
			});
			expect(res.status, path).toBe(415);
		}
	});
});
