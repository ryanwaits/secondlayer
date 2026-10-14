import { describe, expect, test } from "bun:test";
import robots from "./robots";

const [rule] = [robots().rules].flat();

describe("robots", () => {
	test("robots.txt disallows the internal lab", () => {
		expect(rule.disallow).toContain("/lab");
	});

	test("robots.txt allows the public site", () => {
		expect(rule.allow).toBe("/");
	});
});
