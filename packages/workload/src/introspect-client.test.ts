import { describe, expect, test } from "bun:test";
import { IntrospectClient } from "./introspect-client.ts";

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("IntrospectClient", () => {
	test("a valid key resolves to {ok:true, accountId, creditsOk}", async () => {
		const client = new IntrospectClient({
			appServerUrl: "https://api.secondlayer.tools",
			workloadHostKey: "wh-key",
			fetchImpl: async () =>
				jsonResponse(200, { account_id: "acct_1", credits_ok: true }),
		});
		const result = await client.resolve("sk-sl_good");
		expect(result).toEqual({ ok: true, accountId: "acct_1", creditsOk: true });
	});

	test("a 401 from app-server resolves to {ok:false}", async () => {
		const client = new IntrospectClient({
			appServerUrl: "https://api.secondlayer.tools",
			workloadHostKey: "wh-key",
			fetchImpl: async () => jsonResponse(401, { error: "invalid_key" }),
		});
		expect(await client.resolve("sk-sl_bad")).toEqual({ ok: false });
	});

	test("a network failure to app-server fails closed, not open", async () => {
		const client = new IntrospectClient({
			appServerUrl: "https://api.secondlayer.tools",
			workloadHostKey: "wh-key",
			fetchImpl: async () => {
				throw new Error("ECONNREFUSED");
			},
		});
		expect(await client.resolve("sk-sl_whatever")).toEqual({ ok: false });
	});

	test("sends the workload host key and the presented key, not the reverse", async () => {
		const seen: { auth: string | null; body: unknown } = {
			auth: null,
			body: undefined,
		};
		const client = new IntrospectClient({
			appServerUrl: "https://api.secondlayer.tools",
			workloadHostKey: "wh-secret",
			fetchImpl: async (_url, init) => {
				seen.auth = (init?.headers as Record<string, string>).authorization;
				seen.body = JSON.parse(String(init?.body));
				return jsonResponse(200, { account_id: "acct_1", credits_ok: true });
			},
		});
		await client.resolve("sk-sl_customer");
		expect(seen.auth).toBe("Bearer wh-secret");
		expect(seen.body).toEqual({ key: "sk-sl_customer" });
	});

	test("caches a positive result for positiveTtlMs, then refetches", async () => {
		let calls = 0;
		let clock = 0;
		const client = new IntrospectClient({
			appServerUrl: "https://api.secondlayer.tools",
			workloadHostKey: "wh-key",
			now: () => clock,
			positiveTtlMs: 60_000,
			fetchImpl: async () => {
				calls++;
				return jsonResponse(200, { account_id: "acct_1", credits_ok: true });
			},
		});
		await client.resolve("sk-sl_good");
		clock += 59_000;
		await client.resolve("sk-sl_good");
		expect(calls).toBe(1); // still cached

		clock += 2_000; // now 61s since the first call
		await client.resolve("sk-sl_good");
		expect(calls).toBe(2); // cache expired, refetched
	});

	test("caches a negative result for a shorter TTL than a positive one", async () => {
		let calls = 0;
		let clock = 0;
		const client = new IntrospectClient({
			appServerUrl: "https://api.secondlayer.tools",
			workloadHostKey: "wh-key",
			now: () => clock,
			negativeTtlMs: 10_000,
			fetchImpl: async () => {
				calls++;
				return jsonResponse(401, { error: "invalid_key" });
			},
		});
		await client.resolve("sk-sl_bad");
		clock += 9_000;
		await client.resolve("sk-sl_bad");
		expect(calls).toBe(1);

		clock += 2_000; // now 11s
		await client.resolve("sk-sl_bad");
		expect(calls).toBe(2);
	});

	test("a revoked key stops working within the positive TTL window (60s)", async () => {
		let revoked = false;
		let clock = 0;
		const client = new IntrospectClient({
			appServerUrl: "https://api.secondlayer.tools",
			workloadHostKey: "wh-key",
			now: () => clock,
			fetchImpl: async () =>
				revoked
					? jsonResponse(401, { error: "invalid_key" })
					: jsonResponse(200, { account_id: "acct_1", credits_ok: true }),
		});
		expect((await client.resolve("sk-sl_key")).ok).toBe(true);
		revoked = true;
		clock += 61_000; // past the 60s positive cache
		expect((await client.resolve("sk-sl_key")).ok).toBe(false);
	});

	test("concurrent lookups for the same key coalesce into one upstream call", async () => {
		let calls = 0;
		const client = new IntrospectClient({
			appServerUrl: "https://api.secondlayer.tools",
			workloadHostKey: "wh-key",
			fetchImpl: async () => {
				calls++;
				await new Promise((r) => setTimeout(r, 10));
				return jsonResponse(200, { account_id: "acct_1", credits_ok: true });
			},
		});
		const [a, b, c] = await Promise.all([
			client.resolve("sk-sl_same"),
			client.resolve("sk-sl_same"),
			client.resolve("sk-sl_same"),
		]);
		expect(calls).toBe(1);
		expect(a).toEqual(b);
		expect(b).toEqual(c);
	});

	test("clearCache forces the next resolve back to app-server", async () => {
		let calls = 0;
		const client = new IntrospectClient({
			appServerUrl: "https://api.secondlayer.tools",
			workloadHostKey: "wh-key",
			fetchImpl: async () => {
				calls++;
				return jsonResponse(200, { account_id: "acct_1", credits_ok: true });
			},
		});
		await client.resolve("sk-sl_x");
		client.clearCache();
		await client.resolve("sk-sl_x");
		expect(calls).toBe(2);
	});
});
