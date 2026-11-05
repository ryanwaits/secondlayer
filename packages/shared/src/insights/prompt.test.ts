import { describe, expect, test } from "bun:test";
import { plural } from "./prompt.ts";

describe("plural", () => {
	test("a consonant before a final y takes ies", () => {
		expect(plural(851, "delivery")).toBe("851 deliveries");
		expect(plural(1, "delivery")).toBe("1 delivery");
	});

	test("a vowel before a final y and other nouns take s", () => {
		expect(plural(3, "day")).toBe("3 days");
		expect(plural(2, "key")).toBe("2 keys");
		expect(plural(1361, "poll")).toBe("1,361 polls");
	});

	test("an irregular plural is passed in", () => {
		expect(plural(2, "child", "children")).toBe("2 children");
	});
});
