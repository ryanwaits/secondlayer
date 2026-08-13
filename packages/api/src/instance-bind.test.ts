import { describe, expect, test } from "bun:test";
import {
	UnauthenticatedBindError,
	assertInstanceBindAuth,
	decideInstanceAuth,
	isLoopbackHost,
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
});
