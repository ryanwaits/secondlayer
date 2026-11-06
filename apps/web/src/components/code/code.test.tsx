import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LADDER_HEXES } from "@/lib/syntax-theme";
import { renderToStaticMarkup } from "react-dom/server";
import { Code, type CodeProps } from "./code";

/** `Code` is an async server component; resolve it, then render its sync tree. */
async function html(props: CodeProps): Promise<string> {
	return renderToStaticMarkup(await Code(props));
}

describe("markup", () => {
	test("source text is escaped, never markup", async () => {
		const out = await html({
			lang: "ts",
			code: 'const a = "<img src=x onerror=alert(1)>" + "&";',
		});
		expect(out).not.toContain("<img");
		expect(out).toContain("&lt;img");
		expect(out).toContain("&amp;");
	});

	test("a callout's and an error's text is escaped too", async () => {
		const out = await html({
			lang: "ts",
			code: "// !callout[/a/] <b>x</b>\nconst a = 1;",
		});
		expect(out).not.toContain("<b>");
		expect(out).toContain("&lt;b&gt;");
	});

	test("the stylesheet mirrors the theme's ladder", () => {
		const css = readFileSync(join(import.meta.dir, "code.css"), "utf8");
		for (const [step, hex] of Object.entries(LADDER_HEXES)) {
			const rule = new RegExp(
				`\\.cb \\.t-${step} \\{\\s*--shiki-light: ${hex.light};\\s*--shiki-dark: ${hex.dark};`,
				"i",
			);
			expect(css, step).toMatch(rule);
		}
	});
});

describe("docs key slots", () => {
	const curl =
		'curl https://api.secondlayer.tools/v1/streams/tip -H "Authorization: Bearer $SECONDLAYER_API_KEY"';

	test("the server never renders a key value", async () => {
		const out = await html({ lang: "sh", title: "tip", code: curl });
		expect(out).not.toMatch(/sk-sl_/);
	});
});
