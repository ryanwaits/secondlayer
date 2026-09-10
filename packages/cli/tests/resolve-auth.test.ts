import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { isOssMode, resolveAuth } from "../src/lib/resolve-auth";

const AUTH_ENV = [
	"SECONDLAYER_API_URL",
	"SL_API_URL",
	"SL_PLATFORM_API_URL",
	"INSTANCE_TOKEN",
	"SECONDLAYER_API_KEY",
	"SL_API_KEY",
	"SL_SERVICE_KEY",
	"SL_STREAMS_API_KEY",
] as const;

describe("resolveAuth", () => {
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

	it("authenticates from INSTANCE_TOKEN alone, with no session and no API URL", async () => {
		process.env.INSTANCE_TOKEN = "a".repeat(64);
		const auth = await resolveAuth();
		expect(auth.ephemeralKey).toBe("a".repeat(64));
		expect(auth.fromEnv).toBe(true);
	});

	it("ignores legacy SL_SERVICE_KEY / SL_STREAMS_API_KEY / SL_API_KEY for instance auth", async () => {
		process.env.INSTANCE_TOKEN = "primary";
		process.env.SL_API_KEY = "sk-sl_account";
		process.env.SL_SERVICE_KEY = "legacy";
		process.env.SL_STREAMS_API_KEY = "streams";
		const auth = await resolveAuth();
		expect(auth.ephemeralKey).toBe("primary");
	});

	it("resolves the endpoint from SECONDLAYER_API_URL independently of the key", async () => {
		process.env.SECONDLAYER_API_URL = "http://localhost:3800";
		process.env.INSTANCE_TOKEN = "k";
		const auth = await resolveAuth();
		expect(auth.apiUrl).toBe("http://localhost:3800");
	});

	it("OSS with no key does not require login", async () => {
		process.env.SECONDLAYER_API_URL = "http://127.0.0.1:3800";
		const auth = await resolveAuth();
		expect(auth.apiUrl).toBe("http://127.0.0.1:3800");
		expect(auth.ephemeralKey).toBe("");
		expect(auth.fromEnv).toBe(true);
	});
});

describe("isOssMode", () => {
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

	it("is true whenever the CLI points at a custom endpoint", () => {
		process.env.SECONDLAYER_API_URL = "http://localhost:3800";
		expect(isOssMode()).toBe(true);
	});

	it("defaults to the local one-box API (self-host)", () => {
		expect(isOssMode()).toBe(true);
	});

	it("is false only when pointed at archive-ops", () => {
		process.env.SECONDLAYER_API_URL = "https://api.secondlayer.tools";
		expect(isOssMode()).toBe(false);
	});
});
