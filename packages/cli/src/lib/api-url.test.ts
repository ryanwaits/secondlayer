import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	LOCAL_API_URL,
	assertInstanceUrl,
	isMerchantUrl,
	resolveApiUrl,
} from "./api-url.ts";

const URL_ENV = [
	"SECONDLAYER_API_URL",
	"SL_API_URL",
	"SL_PLATFORM_API_URL",
] as const;

describe("isMerchantUrl / assertInstanceUrl / resolveApiUrl", () => {
	let saved: Record<string, string | undefined>;

	beforeEach(() => {
		saved = {};
		for (const k of URL_ENV) {
			saved[k] = process.env[k];
			Reflect.deleteProperty(process.env, k);
		}
	});

	afterEach(() => {
		for (const k of URL_ENV) {
			if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
			else process.env[k] = saved[k];
		}
	});

	test("default URL is not merchant", () => {
		expect(resolveApiUrl()).toBe(LOCAL_API_URL);
		expect(isMerchantUrl()).toBe(false);
		expect(() => assertInstanceUrl()).not.toThrow();
	});

	test("loopback and Railway https are not merchant", () => {
		expect(isMerchantUrl("http://127.0.0.1:3800")).toBe(false);
		expect(isMerchantUrl("https://my-box.up.railway.app")).toBe(false);
		expect(() => assertInstanceUrl("http://127.0.0.1:3800")).not.toThrow();
		expect(() =>
			assertInstanceUrl("https://my-box.up.railway.app"),
		).not.toThrow();
	});

	test("merchant hostname is merchant, with or without path/slash", () => {
		expect(isMerchantUrl("https://api.secondlayer.tools")).toBe(true);
		expect(isMerchantUrl("https://api.secondlayer.tools/")).toBe(true);
		expect(isMerchantUrl("https://api.secondlayer.tools/v1")).toBe(true);
		expect(() => assertInstanceUrl("https://api.secondlayer.tools")).toThrow(
			/this command runs on your instance/,
		);
	});

	test("garbage URL is not merchant", () => {
		expect(isMerchantUrl("not a url")).toBe(false);
		expect(() => assertInstanceUrl("not a url")).not.toThrow();
	});

	test("SECONDLAYER_API_URL wins over SL_API_URL", () => {
		process.env.SECONDLAYER_API_URL = "http://127.0.0.1:3800";
		process.env.SL_API_URL = "https://api.secondlayer.tools";
		expect(resolveApiUrl()).toBe("http://127.0.0.1:3800");
		expect(isMerchantUrl()).toBe(false);
	});

	test("assertInstanceUrl throws only when resolveApiUrl is merchant", () => {
		process.env.SECONDLAYER_API_URL = "https://api.secondlayer.tools";
		expect(() => assertInstanceUrl()).toThrow(/unset SECONDLAYER_API_URL/);
	});
});
