import { afterEach, describe, expect, test } from "bun:test";
import type { Context } from "hono";
import { getClientIp, ipBucket } from "./http.ts";

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

describe("ipBucket", () => {
	test("an IPv4 address is its own bucket", () => {
		expect(ipBucket("203.0.113.7")).toBe("203.0.113.7");
	});

	test("addresses in one IPv6 /64 share a bucket", () => {
		const a = ipBucket("2001:db8:abcd:12:1111:2222:3333:4444");
		expect(a).toBe("2001:db8:abcd:12::/64");
		expect(ipBucket("2001:0db8:abcd:0012::1")).toBe(a);
		expect(ipBucket("2001:DB8:ABCD:12:ffff:ffff:ffff:ffff")).toBe(a);
	});

	test("different IPv6 /64s get different buckets", () => {
		expect(ipBucket("2001:db8:abcd:12::1")).not.toBe(
			ipBucket("2001:db8:abcd:13::1"),
		);
	});

	test("a compressed address keeps its zero groups in the /64", () => {
		expect(ipBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
		expect(ipBucket("::1")).toBe("0:0:0:0::/64");
	});

	test("an IPv4-mapped IPv6 address buckets as the IPv4", () => {
		expect(ipBucket("::ffff:203.0.113.7")).toBe("203.0.113.7");
		expect(ipBucket("::ffff:cb00:7107")).toBe("203.0.113.7");
	});

	test("an IPv6 zone id is ignored", () => {
		expect(ipBucket("fe80::1%eth0")).toBe(ipBucket("fe80::2"));
	});

	test("unknown and unparseable values pass through", () => {
		expect(ipBucket("unknown")).toBe("unknown");
		expect(ipBucket("not-an-ip")).toBe("not-an-ip");
	});
});
