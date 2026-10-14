import { describe, expect, test } from "bun:test";
import { leadUnder, mdxToMarkdown, sectionLead } from "@/lib/docs-source";
import { renderToStaticMarkup } from "react-dom/server";
import { Pick, Tip } from "./prose";

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
	test("renders its words with the section's first sentence in an attribute, and never links", async () => {
		const href = "/docs/authentication#your-key";
		const out = renderToStaticMarkup(await Tip({ href, children: "your key" }));
		const summary = await sectionLead(href);
		expect(out).toContain('class="tip"');
		expect(out).toContain('tabindex="0"');
		expect(out).toContain(`&quot;summary&quot;:&quot;${summary}&quot;`);
		expect(out).toContain(">your key</span>");
		expect(out).not.toContain("<a ");
		expect(out).not.toContain("href=");
	});

	test("a section that is not there fails the build", async () => {
		await expect(
			Tip({ href: "/docs/authentication#no-such-section" }),
		).rejects.toThrow("no section with the anchor");
	});
});

describe("leadUnder", () => {
	const page = [
		"# Title",
		"",
		"Intro words.",
		"",
		"## Keys",
		"",
		"```bash",
		"curl $URL",
		"```",
		"",
		"[Sign in](https://x.dev) with `email`. Then more words here.",
		"",
		"## Long",
		"",
		`${"word ".repeat(30)}end.`,
		"",
		"## Empty",
		"",
		"| a | b |",
		"| - | - |",
		"",
		"## Keys",
		"",
		"Second keys section.",
	].join("\n");

	test("is the first sentence of the first prose paragraph, as plain text", () => {
		expect(leadUnder(page, "keys", "t")).toBe("Sign in with email.");
		expect(leadUnder(page, "keys-1", "t")).toBe("Second keys section.");
	});

	test("throws for a missing anchor, a section with no prose, or a long sentence", () => {
		expect(() => leadUnder(page, "nope", "t")).toThrow("no section");
		expect(() => leadUnder(page, "empty", "t")).toThrow("no prose");
		expect(() => leadUnder(page, "long", "t")).toThrow("max 120");
	});

	test("the markdown twin reads a tip as its text", () => {
		expect(mdxToMarkdown("A [word](tip:/docs/x#y) here.")).toBe("A word here.");
	});
});
