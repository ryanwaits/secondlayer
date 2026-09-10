import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { applyApiKeyFlag, resolveEnvKey } from "./resolve-auth.ts";

describe("resolveEnvKey credential precedence", () => {
	const originalToken = process.env.INSTANCE_TOKEN;
	const originalLegacy = process.env.SL_API_KEY;
	const originalAccount = process.env.SECONDLAYER_API_KEY;

	beforeEach(() => {
		delete process.env.INSTANCE_TOKEN;
		delete process.env.SL_API_KEY;
		delete process.env.SECONDLAYER_API_KEY;
	});

	afterEach(() => {
		if (originalToken === undefined) delete process.env.INSTANCE_TOKEN;
		else process.env.INSTANCE_TOKEN = originalToken;
		if (originalLegacy === undefined) delete process.env.SL_API_KEY;
		else process.env.SL_API_KEY = originalLegacy;
		if (originalAccount === undefined) delete process.env.SECONDLAYER_API_KEY;
		else process.env.SECONDLAYER_API_KEY = originalAccount;
	});

	test("reads INSTANCE_TOKEN on its own", () => {
		process.env.INSTANCE_TOKEN = "token-from-init";
		expect(resolveEnvKey()).toBe("token-from-init");
	});

	test("does not read SL_API_KEY (hosted account key, not instance)", () => {
		process.env.SL_API_KEY = "sk-sl_legacy";
		expect(resolveEnvKey()).toBeUndefined();
	});

	test("does not read SECONDLAYER_API_KEY", () => {
		process.env.SECONDLAYER_API_KEY = "sk-sl_account";
		expect(resolveEnvKey()).toBeUndefined();
	});

	test("INSTANCE_TOKEN wins; SL_API_KEY is ignored even when both set", () => {
		process.env.INSTANCE_TOKEN = "token-from-init";
		process.env.SL_API_KEY = "sk-sl_legacy";
		expect(resolveEnvKey()).toBe("token-from-init");
	});

	test("treats an empty INSTANCE_TOKEN as unset", () => {
		process.env.INSTANCE_TOKEN = "";
		process.env.SL_API_KEY = "sk-sl_legacy";
		expect(resolveEnvKey()).toBeUndefined();
	});

	test("resolves to undefined when neither is set", () => {
		expect(resolveEnvKey()).toBeUndefined();
	});

	test("resolves to undefined when both are empty", () => {
		process.env.INSTANCE_TOKEN = "";
		process.env.SL_API_KEY = "";
		expect(resolveEnvKey()).toBeUndefined();
	});

	test("hex --api-key funnel sets INSTANCE_TOKEN only", () => {
		process.env.INSTANCE_TOKEN = "exported-token";
		applyApiKeyFlag("a".repeat(64));
		expect(process.env.INSTANCE_TOKEN).toBe("a".repeat(64));
		expect(process.env.SECONDLAYER_API_KEY).toBeUndefined();
		expect(process.env.SL_API_KEY).toBeUndefined();
		expect(resolveEnvKey()).toBe("a".repeat(64));
	});

	test("sk-sl_* --api-key funnel sets SECONDLAYER_API_KEY, not INSTANCE_TOKEN", () => {
		process.env.INSTANCE_TOKEN = "exported-token";
		applyApiKeyFlag("sk-sl_from_flag");
		expect(process.env.SECONDLAYER_API_KEY).toBe("sk-sl_from_flag");
		expect(process.env.SL_API_KEY).toBe("sk-sl_from_flag");
		expect(process.env.INSTANCE_TOKEN).toBe("exported-token");
		expect(resolveEnvKey()).toBe("exported-token");
	});
});
