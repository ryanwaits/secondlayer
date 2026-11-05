import { describe, expect, test } from "bun:test";
import { homeHref } from "./home-link";

describe("homeHref", () => {
	test("a signed-in reader's logo goes straight to the Overview", () => {
		expect(homeHref(true)).toBe("/account");
	});

	test("everyone else's logo goes home", () => {
		expect(homeHref(false)).toBe("/");
	});
});
