import { afterEach, describe, expect, test } from "bun:test";
import { deriveBaseUrl } from "./urls.ts";

describe("deriveBaseUrl", () => {
	afterEach(() => {
		process.env.SL_DASHBOARD_URL = undefined;
	});

	test("strips api. subdomain", () => {
		expect(deriveBaseUrl("https://api.secondlayer.tools")).toBe(
			"https://secondlayer.tools",
		);
	});

	test("preserves nested subdomains except leading api.", () => {
		expect(deriveBaseUrl("https://api.staging.secondlayer.tools")).toBe(
			"https://staging.secondlayer.tools",
		);
	});

	test("works without api. prefix", () => {
		expect(deriveBaseUrl("https://secondlayer.tools")).toBe(
			"https://secondlayer.tools",
		);
	});

	test("SL_DASHBOARD_URL env override wins", () => {
		process.env.SL_DASHBOARD_URL = "https://custom.example/";
		expect(deriveBaseUrl("https://api.secondlayer.tools")).toBe(
			"https://custom.example",
		);
	});

	test("returns input on parse failure", () => {
		expect(deriveBaseUrl("not-a-url")).toBe("not-a-url");
	});
});
