import { describe, expect, test } from "bun:test";
import {
	allContainerNames,
	apiContainerName,
	generateSlug,
	isValidSlug,
	pgContainerName,
	processorContainerName,
	volumeName,
} from "../src/names.ts";

describe("names", () => {
	test("generateSlug produces 8-char lowercase alphanumeric", () => {
		for (let i = 0; i < 100; i++) {
			const slug = generateSlug();
			expect(slug.length).toBe(8);
			expect(isValidSlug(slug)).toBe(true);
		}
	});

	test("generateSlug is unique across many calls", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 1000; i++) seen.add(generateSlug());
		// 36^8 = 2.8T possibilities; 1000 trials should all be unique.
		expect(seen.size).toBe(1000);
	});

	test("isValidSlug rejects wrong length", () => {
		expect(isValidSlug("abc")).toBe(false);
		expect(isValidSlug("abcdefghi")).toBe(false);
		expect(isValidSlug("")).toBe(false);
	});

	test("isValidSlug rejects non-alphanumeric", () => {
		expect(isValidSlug("abc-defg")).toBe(false);
		expect(isValidSlug("ABCDEFGH")).toBe(false);
		expect(isValidSlug("abcdefg_")).toBe(false);
	});

	test("container names include slug", () => {
		expect(pgContainerName("abc12345")).toBe("sl-pg-abc12345");
		expect(apiContainerName("abc12345")).toBe("sl-api-abc12345");
		expect(processorContainerName("abc12345")).toBe("sl-proc-abc12345");
		expect(volumeName("abc12345")).toBe("sl-data-abc12345");
	});

	test("allContainerNames returns all three in orchestration order", () => {
		expect(allContainerNames("abc12345")).toEqual([
			"sl-pg-abc12345",
			"sl-api-abc12345",
			"sl-proc-abc12345",
		]);
	});
});
