import { describe, expect, test } from "bun:test";
import { isSameOrigin } from "./same-origin";

const req = (headers: Record<string, string>) =>
	new Request("https://www.secondlayer.tools/api/keys/docs", {
		method: "POST",
		headers,
	});

describe("isSameOrigin", () => {
	test("accepts an Origin that matches the host", () => {
		expect(
			isSameOrigin(
				req({
					origin: "https://www.secondlayer.tools",
					host: "www.secondlayer.tools",
				}),
			),
		).toBe(true);
	});

	test("follows x-forwarded-host behind a proxy", () => {
		expect(
			isSameOrigin(
				req({
					origin: "https://www.secondlayer.tools",
					host: "internal:3000",
					"x-forwarded-host": "www.secondlayer.tools",
				}),
			),
		).toBe(true);
	});

	test("refuses a request with no Origin", () => {
		expect(isSameOrigin(req({ host: "www.secondlayer.tools" }))).toBe(false);
	});

	test("refuses a foreign Origin", () => {
		expect(
			isSameOrigin(
				req({ origin: "https://evil.example", host: "www.secondlayer.tools" }),
			),
		).toBe(false);
	});

	test("refuses a lookalike host", () => {
		expect(
			isSameOrigin(
				req({
					origin: "https://www.secondlayer.tools.evil.example",
					host: "www.secondlayer.tools",
				}),
			),
		).toBe(false);
	});

	test("refuses a browser that reports a cross-site fetch", () => {
		expect(
			isSameOrigin(
				req({
					origin: "https://www.secondlayer.tools",
					host: "www.secondlayer.tools",
					"sec-fetch-site": "cross-site",
				}),
			),
		).toBe(false);
	});

	test("refuses an Origin that is not a URL or not http(s)", () => {
		expect(
			isSameOrigin(req({ origin: "null", host: "www.secondlayer.tools" })),
		).toBe(false);
		expect(
			isSameOrigin(
				req({
					origin: "file://www.secondlayer.tools",
					host: "www.secondlayer.tools",
				}),
			),
		).toBe(false);
	});
});
