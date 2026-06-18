import { afterEach, describe, expect, test } from "bun:test";
import type { Context } from "hono";
import { getClientIp } from "./http.ts";

// Minimal Context stub: getClientIp only reads request headers.
function ctx(headers: Record<string, string>): Context {
	return {
		req: { header: (name: string) => headers[name.toLowerCase()] },
	} as unknown as Context;
}

const ENV_KEYS = ["TRUSTED_PROXY_HOPS", "TRUST_CF_CONNECTING_IP"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe("getClientIp", () => {
	test("single XFF entry (one trusted proxy appended the real client)", () => {
		delete process.env.TRUSTED_PROXY_HOPS; // default 1
		expect(getClientIp(ctx({ "x-forwarded-for": "1.1.1.1" }))).toBe("1.1.1.1");
	});

	test("forged XFF is ignored — the proxy-appended last hop wins", () => {
		// Attacker sends "9.9.9.9"; Caddy appends the real source to the tail.
		expect(getClientIp(ctx({ "x-forwarded-for": "9.9.9.9, 1.1.1.1" }))).toBe(
			"1.1.1.1",
		);
	});

	test("no XFF → unknown (caller must fail closed, not exempt)", () => {
		expect(getClientIp(ctx({}))).toBe("unknown");
	});

	test("cf-connecting-ip is NOT trusted by default (spoofable, no Cloudflare)", () => {
		expect(
			getClientIp(
				ctx({ "cf-connecting-ip": "6.6.6.6", "x-forwarded-for": "1.1.1.1" }),
			),
		).toBe("1.1.1.1");
	});

	test("cf-connecting-ip trusted only when TRUST_CF_CONNECTING_IP=true", () => {
		process.env.TRUST_CF_CONNECTING_IP = "true";
		expect(getClientIp(ctx({ "cf-connecting-ip": "6.6.6.6" }))).toBe("6.6.6.6");
	});

	test("TRUSTED_PROXY_HOPS=2 takes the client two hops from the end", () => {
		process.env.TRUSTED_PROXY_HOPS = "2";
		expect(
			getClientIp(ctx({ "x-forwarded-for": "client, proxy1, proxy2" })),
		).toBe("proxy1");
	});

	test("more trusted hops than XFF entries → unknown (cannot trust)", () => {
		process.env.TRUSTED_PROXY_HOPS = "3";
		expect(getClientIp(ctx({ "x-forwarded-for": "1.1.1.1" }))).toBe("unknown");
	});

	test("TRUSTED_PROXY_HOPS=0 never trusts XFF", () => {
		process.env.TRUSTED_PROXY_HOPS = "0";
		expect(getClientIp(ctx({ "x-forwarded-for": "1.1.1.1" }))).toBe("unknown");
	});
});
