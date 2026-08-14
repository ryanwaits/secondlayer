import { afterEach, describe, expect, test } from "bun:test";
import { LOCAL_API_URL, resolveBaseUrl } from "./base.ts";

describe("resolveBaseUrl", () => {
	const saved = {
		SL_API_URL: process.env.SL_API_URL,
		SECONDLAYER_API_URL: process.env.SECONDLAYER_API_URL,
	};

	afterEach(() => {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) Reflect.deleteProperty(process.env, k);
			else process.env[k] = v;
		}
	});

	test("explicit wins", () => {
		expect(resolveBaseUrl("https://example.test/")).toBe(
			"https://example.test",
		);
	});

	test("SL_API_URL then local default", () => {
		Reflect.deleteProperty(process.env, "SL_API_URL");
		Reflect.deleteProperty(process.env, "SECONDLAYER_API_URL");
		expect(resolveBaseUrl()).toBe(LOCAL_API_URL);
		process.env.SL_API_URL = "http://localhost:3999";
		expect(resolveBaseUrl()).toBe("http://localhost:3999");
	});
});
