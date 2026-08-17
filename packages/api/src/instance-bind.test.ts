import { describe, expect, test } from "bun:test";
import {
	UnauthenticatedBindError,
	assertInstanceBindAuth,
	decideInstanceAuth,
	isLoopbackHost,
	isLoopbackReachable,
	parsePublishHost,
	resolveInstanceToken,
	resolveListenHost,
} from "./instance-bind.ts";

describe("isLoopbackHost", () => {
	test.each([
		["127.0.0.1", true],
		["::1", true],
		["[::1]", true],
		["localhost", true],
		["0.0.0.0", false],
		["::", false],
		["192.168.1.9", false],
	] as const)("%s → %s", (host, expected) => {
		expect(isLoopbackHost(host)).toBe(expected);
	});
});

describe("resolveListenHost / resolveInstanceToken", () => {
	test("listen defaults to 127.0.0.1", () => {
		expect(resolveListenHost({})).toBe("127.0.0.1");
	});

	test("LISTEN_HOST wins over HOST", () => {
		expect(resolveListenHost({ LISTEN_HOST: "0.0.0.0", HOST: "::1" })).toBe(
			"0.0.0.0",
		);
	});

	test("INSTANCE_TOKEN wins over API_KEY", () => {
		expect(resolveInstanceToken({ INSTANCE_TOKEN: "a", API_KEY: "b" })).toBe(
			"a",
		);
		expect(resolveInstanceToken({ API_KEY: "b" })).toBe("b");
		expect(resolveInstanceToken({})).toBeNull();
	});
});

describe("parsePublishHost", () => {
	test.each([
		// Docker publish specs an operator actually writes.
		["127.0.0.1:3800", "127.0.0.1"],
		["localhost:3800", "localhost"],
		["0.0.0.0:3800", "0.0.0.0"],
		["192.168.1.9:3800", "192.168.1.9"],
		["[::1]:3800", "::1"],
		["127.0.0.1:3800:3800", "127.0.0.1"],
		["  127.0.0.1:3800  ", "127.0.0.1"],
		// No host named — Docker publishes these on every interface.
		["3800", null],
		["", null],
		["   ", null],
		[":3800", null],
		// Unparseable: an unbracketed IPv6 spec we refuse to guess at.
		["::1:3800", null],
		["not a spec at all", null],
	] as const)("%p → %p", (spec, expected) => {
		expect(parsePublishHost(spec)).toBe(expected);
	});
});

describe("isLoopbackReachable", () => {
	test.each([
		// The publish spec wins whenever it is set: this is the container case,
		// where LISTEN_HOST is always 0.0.0.0 and says nothing about reach.
		{
			name: "loopback publish over a public bind",
			env: { LISTEN_HOST: "0.0.0.0", API_PUBLISH_ADDR: "127.0.0.1:3800" },
			expected: true,
		},
		{
			name: "localhost publish",
			env: { LISTEN_HOST: "0.0.0.0", API_PUBLISH_ADDR: "localhost:3800" },
			expected: true,
		},
		{
			name: "IPv6 loopback publish",
			env: { LISTEN_HOST: "0.0.0.0", API_PUBLISH_ADDR: "[::1]:3800" },
			expected: true,
		},
		{
			name: "wildcard publish",
			env: { LISTEN_HOST: "0.0.0.0", API_PUBLISH_ADDR: "0.0.0.0:3800" },
			expected: false,
		},
		{
			name: "LAN publish",
			env: { LISTEN_HOST: "127.0.0.1", API_PUBLISH_ADDR: "192.168.1.9:3800" },
			expected: false,
		},
		// Fail-safe cases: a spec that names no host publishes everywhere, and
		// garbage never opens the read plane.
		{
			name: "bare port publishes on every interface",
			env: { LISTEN_HOST: "127.0.0.1", API_PUBLISH_ADDR: "3800" },
			expected: false,
		},
		{
			name: "garbage spec",
			env: { LISTEN_HOST: "127.0.0.1", API_PUBLISH_ADDR: "not a spec at all" },
			expected: false,
		},
		{
			name: "unbracketed IPv6 spec",
			env: { LISTEN_HOST: "127.0.0.1", API_PUBLISH_ADDR: "::1:3800" },
			expected: false,
		},
		// Unset or blank → fall back to the declared bind (bare metal, systemd).
		{
			name: "unset falls back to a loopback bind",
			env: { LISTEN_HOST: "127.0.0.1" },
			expected: true,
		},
		{
			name: "unset falls back to a public bind",
			env: { LISTEN_HOST: "0.0.0.0" },
			expected: false,
		},
		{
			name: "blank falls back to the bind",
			env: { LISTEN_HOST: "0.0.0.0", API_PUBLISH_ADDR: "   " },
			expected: false,
		},
		{
			name: "nothing set at all defaults to loopback",
			env: {},
			expected: true,
		},
	] as const)("$name", (row) => {
		expect(isLoopbackReachable(row.env)).toBe(row.expected);
	});
});

describe("bind/auth matrix", () => {
	test.each([
		{
			name: "loopback, no token",
			host: "127.0.0.1",
			token: null,
			start: true,
			requireToken: false,
		},
		{
			name: "localhost, no token",
			host: "localhost",
			token: null,
			start: true,
			requireToken: false,
		},
		{
			name: "loopback, token set",
			host: "127.0.0.1",
			token: "secret",
			start: true,
			requireToken: true,
		},
		{
			name: "public bind, token set",
			host: "0.0.0.0",
			token: "secret",
			start: true,
			requireToken: true,
		},
		{
			name: "public bind, no token",
			host: "0.0.0.0",
			token: null,
			start: false,
			requireToken: false,
		},
		{
			name: "wildcard v6, no token",
			host: "::",
			token: null,
			start: false,
			requireToken: false,
		},
	] as const)("$name", (row) => {
		const decision = decideInstanceAuth({ host: row.host, token: row.token });
		if (!row.start) {
			expect(decision).toEqual({
				start: false,
				reason: "unauthenticated-bind",
			});
			expect(() =>
				assertInstanceBindAuth({ host: row.host, token: row.token }),
			).toThrow(UnauthenticatedBindError);
			return;
		}
		expect(decision).toEqual({
			start: true,
			requireToken: row.requireToken,
		});
		expect(() =>
			assertInstanceBindAuth({ host: row.host, token: row.token }),
		).not.toThrow();
	});

	test("a loopback publish spec does not let a public bind boot without a token", () => {
		const prev = process.env.API_PUBLISH_ADDR;
		process.env.API_PUBLISH_ADDR = "127.0.0.1:3800";
		try {
			// The publish spec may open the read plane. It must never reach the
			// boot guard, which takes the real bind and nothing else.
			expect(() =>
				assertInstanceBindAuth({ host: "0.0.0.0", token: null }),
			).toThrow(UnauthenticatedBindError);
			expect(decideInstanceAuth({ host: "0.0.0.0", token: null })).toEqual({
				start: false,
				reason: "unauthenticated-bind",
			});
		} finally {
			if (prev === undefined)
				Reflect.deleteProperty(process.env, "API_PUBLISH_ADDR");
			else process.env.API_PUBLISH_ADDR = prev;
		}
	});
});
