import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { isOssMode, resolveAuth } from "../src/lib/resolve-auth";

const AUTH_ENV = [
	"SL_API_URL",
	"SL_PLATFORM_API_URL",
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

	it("authenticates from an env key alone, with no session and no SL_API_URL", async () => {
		// Regression: previously required BOTH SL_API_URL and a key, so a key
		// alone fell through to the session path and threw.
		process.env.SL_API_KEY = "sk-sl_envkey";
		const auth = await resolveAuth();
		expect(auth.ephemeralKey).toBe("sk-sl_envkey");
		expect(auth.fromEnv).toBe(true);
	});

	it("ignores legacy SL_SERVICE_KEY / SL_STREAMS_API_KEY (only SL_API_KEY is read)", async () => {
		process.env.SL_API_KEY = "primary";
		process.env.SL_SERVICE_KEY = "legacy";
		process.env.SL_STREAMS_API_KEY = "streams";
		const auth = await resolveAuth();
		expect(auth.ephemeralKey).toBe("primary");
	});

	it("resolves the endpoint from SL_API_URL independently of the key", async () => {
		process.env.SL_API_URL = "http://localhost:3800";
		process.env.SL_API_KEY = "k";
		const auth = await resolveAuth();
		expect(auth.apiUrl).toBe("http://localhost:3800");
	});
});

describe("isOssMode", () => {
	let savedUrl: string | undefined;
	let savedKey: string | undefined;

	beforeEach(() => {
		savedUrl = process.env.SL_API_URL;
		savedKey = process.env.SL_SERVICE_KEY;
		Reflect.deleteProperty(process.env, "SL_API_URL");
		Reflect.deleteProperty(process.env, "SL_SERVICE_KEY");
	});

	afterEach(() => {
		if (savedUrl === undefined)
			Reflect.deleteProperty(process.env, "SL_API_URL");
		else process.env.SL_API_URL = savedUrl;
		if (savedKey === undefined)
			Reflect.deleteProperty(process.env, "SL_SERVICE_KEY");
		else process.env.SL_SERVICE_KEY = savedKey;
	});

	it("is true whenever SL_API_URL points the CLI at a custom endpoint", () => {
		// Regression: must not disagree with resolveAuth — SL_API_URL alone used
		// to flip isOssMode true while resolveAuth still hit prod with a session.
		process.env.SL_API_URL = "http://localhost:3800";
		expect(isOssMode()).toBe(true);
	});

	it("is false with no endpoint override", () => {
		expect(isOssMode()).toBe(false);
	});
});
