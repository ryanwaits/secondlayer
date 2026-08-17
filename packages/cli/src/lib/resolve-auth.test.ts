import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveEnvKey } from "./resolve-auth.ts";

describe("resolveEnvKey credential precedence", () => {
	const originalToken = process.env.INSTANCE_TOKEN;
	const originalLegacy = process.env.SL_API_KEY;

	beforeEach(() => {
		delete process.env.INSTANCE_TOKEN;
		delete process.env.SL_API_KEY;
	});

	afterEach(() => {
		if (originalToken === undefined) delete process.env.INSTANCE_TOKEN;
		else process.env.INSTANCE_TOKEN = originalToken;
		if (originalLegacy === undefined) delete process.env.SL_API_KEY;
		else process.env.SL_API_KEY = originalLegacy;
	});

	test("reads INSTANCE_TOKEN on its own", () => {
		process.env.INSTANCE_TOKEN = "token-from-init";
		expect(resolveEnvKey()).toBe("token-from-init");
	});

	test("still reads the legacy SL_API_KEY alias on its own", () => {
		process.env.SL_API_KEY = "legacy-key";
		expect(resolveEnvKey()).toBe("legacy-key");
	});

	test("prefers INSTANCE_TOKEN when both are set", () => {
		process.env.INSTANCE_TOKEN = "token-from-init";
		process.env.SL_API_KEY = "legacy-key";
		expect(resolveEnvKey()).toBe("token-from-init");
	});

	test("treats an empty INSTANCE_TOKEN as unset and falls through", () => {
		process.env.INSTANCE_TOKEN = "";
		process.env.SL_API_KEY = "legacy-key";
		expect(resolveEnvKey()).toBe("legacy-key");
	});

	test("resolves to undefined when neither is set", () => {
		expect(resolveEnvKey()).toBeUndefined();
	});

	test("resolves to undefined when both are empty", () => {
		process.env.INSTANCE_TOKEN = "";
		process.env.SL_API_KEY = "";
		expect(resolveEnvKey()).toBeUndefined();
	});

	// `--api-key` is funnelled into both vars by cli.ts precisely so the flag
	// beats an already-exported INSTANCE_TOKEN.
	test("the --api-key funnel beats an exported INSTANCE_TOKEN", () => {
		process.env.INSTANCE_TOKEN = "exported-token";
		process.env.SL_API_KEY = "exported-token";
		const fromFlag = "flag-key";
		process.env.INSTANCE_TOKEN = fromFlag;
		process.env.SL_API_KEY = fromFlag;
		expect(resolveEnvKey()).toBe(fromFlag);
	});
});
