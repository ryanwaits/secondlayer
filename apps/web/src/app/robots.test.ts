import { describe, expect, test } from "bun:test";
import robots from "./robots";

const [rule] = [robots().rules].flat();

describe("robots", () => {
	test("crawlers are kept out of the internal lab", () => {
		expect(rule.disallow).toContain("/lab");
	});

	test("the public site stays crawlable", () => {
		expect(rule.allow).toBe("/");
	});
});
