import { describe, expect, test } from "bun:test";
import { redactAuthConfig } from "./webhooks.ts";

describe("redactAuthConfig", () => {
	test("bearer with a plaintext token and headers: type, header names, hasSecret — never the token or header values", () => {
		expect(
			redactAuthConfig({
				authType: "bearer",
				token: "s3cret",
				headers: { "x-team": "payouts" },
			}),
		).toEqual({ type: "bearer", headerNames: ["x-team"], hasSecret: true });
	});

	test("bearer with an encrypted token still reports hasSecret", () => {
		expect(
			redactAuthConfig({ authType: "bearer", tokenEnc: "base64ciphertext" }),
		).toEqual({ type: "bearer", headerNames: [], hasSecret: true });
	});

	test("a token with no explicit authType is treated as bearer", () => {
		expect(redactAuthConfig({ token: "implicit" })).toEqual({
			type: "bearer",
			headerNames: [],
			hasSecret: true,
		});
	});

	test("basic auth reports its own type and hasSecret", () => {
		expect(
			redactAuthConfig({ authType: "basic", basicAuth: "dXNlcjpwYXNz" }),
		).toEqual({ type: "basic", headerNames: [], hasSecret: true });
	});

	test("empty auth config reads as none with no secret and no headers", () => {
		expect(redactAuthConfig({})).toEqual({
			type: "none",
			headerNames: [],
			hasSecret: false,
		});
	});

	test("headers alone (raw format, no auth) still list their names with no secret", () => {
		expect(
			redactAuthConfig({ headers: { "x-source": "secondlayer" } }),
		).toEqual({ type: "none", headerNames: ["x-source"], hasSecret: false });
	});
});
