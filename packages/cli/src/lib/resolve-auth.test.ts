import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	applyApiKeyFlag,
	resolveDataPlaneKey,
	resolveEnvKey,
} from "./resolve-auth.ts";

const AUTH_ENV = [
	"INSTANCE_TOKEN",
	"SL_API_KEY",
	"SECONDLAYER_API_KEY",
	"SECONDLAYER_API_URL",
	"SL_API_URL",
	"SL_PLATFORM_API_URL",
] as const;

describe("resolveEnvKey credential precedence", () => {
	let saved: Record<string, string | undefined>;

	beforeEach(() => {
		saved = {};
		for (const k of AUTH_ENV) {
			saved[k] = process.env[k];
			Reflect.deleteProperty(process.env, k);
		}
	});

	afterEach(() => {
		for (const k of AUTH_ENV) {
			if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
			else process.env[k] = saved[k];
		}
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

describe("resolveDataPlaneKey host routing", () => {
	let saved: Record<string, string | undefined>;

	beforeEach(() => {
		saved = {};
		for (const k of AUTH_ENV) {
			saved[k] = process.env[k];
			Reflect.deleteProperty(process.env, k);
		}
	});

	afterEach(() => {
		for (const k of AUTH_ENV) {
			if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
			else process.env[k] = saved[k];
		}
	});

	test("merchant URL + only INSTANCE_TOKEN → undefined", () => {
		process.env.SECONDLAYER_API_URL = "https://api.secondlayer.tools";
		process.env.INSTANCE_TOKEN = "a".repeat(64);
		expect(resolveDataPlaneKey()).toBeUndefined();
	});

	test("merchant URL + SECONDLAYER_API_KEY → that key", () => {
		process.env.SECONDLAYER_API_URL = "https://api.secondlayer.tools";
		process.env.SECONDLAYER_API_KEY = "sk-sl_x";
		expect(resolveDataPlaneKey()).toBe("sk-sl_x");
	});

	test("loopback + INSTANCE_TOKEN → the hex", () => {
		process.env.SECONDLAYER_API_URL = "http://127.0.0.1:3800";
		process.env.INSTANCE_TOKEN = "b".repeat(64);
		expect(resolveDataPlaneKey()).toBe("b".repeat(64));
	});
});
