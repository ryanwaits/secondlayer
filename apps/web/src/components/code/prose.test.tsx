import { describe, expect, test } from "bun:test";
import { mdxToMarkdown } from "@/lib/docs-source";
import { renderToStaticMarkup } from "react-dom/server";
import { Pick, Tip, tipTextProblem } from "./prose";

describe("Pick", () => {
	test("renders the default option as text before any script runs", () => {
		const out = renderToStaticMarkup(
			<Pick name="event" default="ft_transfer" />,
		);
		expect(out).toContain(
			'<span class="picker" data-picker="event">ft_transfer</span>',
		);
	});
});

describe("Tip", () => {
	test("renders its words in an attribute, and never links", () => {
		const out = renderToStaticMarkup(
			<Tip text="Says what it is.">your key</Tip>,
		);
		expect(out).toContain('class="tip"');
		expect(out).toContain('tabindex="0"');
		expect(out).toContain("&quot;summary&quot;:&quot;Says what it is.&quot;");
		expect(out).toContain(">your key</span>");
		expect(out).not.toContain("<a ");
		expect(out).not.toContain("href=");
	});

	test("words that break a rule fail the build with the offending text", () => {
		expect(() => renderToStaticMarkup(<Tip>word</Tip>)).toThrow("no words");
		expect(() =>
			renderToStaticMarkup(<Tip text="Has a `tick`.">word</Tip>),
		).toThrow("Has a `tick`.");
	});
});

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
