import { describe, expect, test } from "bun:test";
import { mdxToMarkdown } from "@/lib/docs-source";
import { tipTextProblem } from "./prose";

describe("tipTextProblem", () => {
	test("accepts one or two short plain sentences", () => {
		expect(tipTextProblem("One thing. Another thing.")).toBeNull();
	});

	test("rejects each broken rule", () => {
		expect(tipTextProblem(undefined)).toContain("no words");
		expect(tipTextProblem("  ")).toContain("no words");
		expect(tipTextProblem("w ".repeat(70))).toContain("max 120");
		expect(tipTextProblem("A \u2014 B.")).toContain("em dash");
		expect(tipTextProblem("Run `sl up`.")).toContain("backtick");
		expect(tipTextProblem("See https://x.dev now.")).toContain("URL");
		expect(tipTextProblem("See /docs/self-host.")).toContain("/docs");
		expect(tipTextProblem("One. Two. Three.")).toContain("two sentences");
	});
});

describe("mdxToMarkdown", () => {
	test("the markdown twin reads a tip as its text", () => {
		expect(mdxToMarkdown('A [word](tip "Says what.") here.')).toBe(
			"A word here.",
		);
	});
});
