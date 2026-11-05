import { describe, expect, test } from "bun:test";
import { buildEmail, parseEmailFile } from "./send-update.ts";

const example = await Bun.file(
	new URL("./updates/example-post.json", import.meta.url),
).json();

describe("parseEmailFile", () => {
	test("accepts the example post", () => {
		expect(parseEmailFile(example).key).toBe("post-clarity-state-from-genesis");
	});

	test("rejects a missing key", () => {
		const { key: _key, ...rest } = example;
		expect(() => parseEmailFile(rest)).toThrow(/key is required/);
	});

	test("rejects a key with uppercase or spaces", () => {
		expect(() => parseEmailFile({ ...example, key: "Bad Key" })).toThrow(
			/key must match/,
		);
	});

	test("rejects an unknown field and names it", () => {
		expect(() => parseEmailFile({ ...example, bogus: 1 })).toThrow(
			/unknown field: bogus/,
		);
	});

	test("rejects a missing cta url", () => {
		expect(() =>
			parseEmailFile({ ...example, cta: { label: "Read" } }),
		).toThrow(/cta/);
	});
});

describe("buildEmail", () => {
	const built = buildEmail(parseEmailFile(example), "tok");

	test("carries the unsubscribe link for the token", () => {
		expect(built.html).toContain("/updates/unsubscribe?t=tok");
	});

	test("highlights the excerpt mark", () => {
		expect(built.html).toContain("reserve[token-wkiki]");
	});

	test("includes the list footnote", () => {
		expect(built.html).toContain(
			"You get these because you subscribed at secondlayer.tools/blog.",
		);
	});

	test("sets one-click unsubscribe headers", () => {
		expect(built.headers["List-Unsubscribe-Post"]).toBe(
			"List-Unsubscribe=One-Click",
		);
		expect(built.headers["List-Unsubscribe"]).toContain("t=tok");
	});
});
