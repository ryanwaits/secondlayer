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

describe("output rules", () => {
	test("each output line takes its tone from what it says", async () => {
		const out = await html({
			lang: "text",
			code: [
				"$ secondlayer verify raw",
				"⚠ 1 of 175 ranges diverge",
				"✓ 174 ranges match",
				"RANGE DATASET STATUS",
				"plain line",
			].join("\n"),
		});
		expect(out).toContain('class="row g o-err"');
		expect(out).toContain('class="row g o-ok"');
		expect(out).toContain('class="row g o-head"');
		expect(out).toContain('class="row g o-out"');
		// The command row keeps shell tokens and a prompt, not an output tone.
		expect(out).toMatch(/<div class="row g"><span class="prompt">\$<\/span>/);
	});

	test("the exit chip and the status chip pick their tone from the number", async () => {
		const ok = await html({ lang: "text", meta: "exit=0", code: "done" });
		expect(ok).toContain('class="exit zero"');
		const bad = await html({ lang: "json", meta: "status=404", code: "{}" });
		expect(bad).toContain('class="status bad"');
		const fine = await html({ lang: "json", meta: "status=200", code: "{}" });
		expect(fine).toContain('class="status ok"');
	});
});

describe("link and error handlers", () => {
	test("!link wraps the token once and an internal path stays on the site", async () => {
		const out = await html({
			lang: "ts",
			code: [
				"// !link[/consume/] /docs/streams",
				"sl.consume(); consume();",
			].join("\n"),
		});
		expect(out.match(/class="lk"/g)).toHaveLength(1);
		expect(out).toContain('href="/docs/streams"');
		expect(out).not.toContain("target=");
	});

	test("!link to another site opens a new tab", async () => {
		const out = await html({
			lang: "ts",
			code: "// !link[/consume/] https://example.com/x\nconsume();",
		});
		expect(out).toContain('href="https://example.com/x"');
		expect(out).toContain('target="_blank"');
	});

	test("!link needs a token and a destination", async () => {
		await expect(html({ lang: "ts", code: "// !link\nx" })).rejects.toThrow(
			"!link needs",
		);
	});

	test("!error squiggles the token, prints the message and turns Copy off", async () => {
		const out = await html({
			lang: "ts",
			code: [
				"await sl.consume({",
				"  // !error[/8948507/] Type 'number' is not assignable to type 'string'.",
				"  fromCursor: 8948507,",
				"});",
			].join("\n"),
		});
		expect(out).toMatch(
			/<span class="squig"><span[^>]*>8948507<\/span><\/span>/,
		);
		expect(out).toContain(
			`<div class="emsg">✗ Type 'number' is not assignable to type 'string'.</div>`,
		);
		expect(out).not.toContain("data-copyable");
		expect(out).not.toContain(">Copy<");
	});

	test("an ordinary block still offers Copy", async () => {
		const out = await html({ lang: "ts", code: "const a = 1;" });
		expect(out).toContain(">Copy<");
		expect(out).toContain('data-copyable=""');
	});
});

describe("automatic links", () => {
	test("an endpoint path in a command links to its API page", async () => {
		const out = await html({
			lang: "sh",
			code: 'curl "$SECONDLAYER_API_URL/v1/streams/tip"',
		});
		expect(out).toMatch(/<a class="lk" href="\/docs\/api\/streams#[a-z-]+"/);
	});

	test("output is never linked, nor a surface that opts out", async () => {
		const text = await html({ lang: "text", code: "GET /v1/streams/tip" });
		expect(text).not.toContain('class="lk"');
		const off = await html({
			lang: "sh",
			code: "curl /v1/streams/tip",
			links: false,
		});
		expect(off).not.toContain('class="lk"');
	});

	test("a manual link keeps its token from also being linked automatically", async () => {
		const out = await html({
			lang: "sh",
			code: "# !link[/v1/streams/tip/] /docs/streams\ncurl $URL/v1/streams/tip",
		});
		expect(out).toContain('href="/docs/streams"');
		expect(out).not.toContain("/docs/api/streams#");
	});
});

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

	test("tokens carry their color as a ladder class, not an inline style", async () => {
		const out = await html({ lang: "ts", code: "const a = 1;" });
		expect(out).toContain('class="t-sub"');
		expect(out).not.toContain("--shiki-light");
	});

	test("a sol fence tokenizes onto the ladder, not one plain token", async () => {
		const out = await html({
			lang: "sol",
			meta: "vault.sol",
			code: "function deposit(uint256 amount) external payable {}",
		});
		expect(out).toContain('class="t-ink');
		expect(out.match(/<span class="t-/g)?.length).toBeGreaterThan(3);
		expect(out).toContain(">sol<");
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

	test("collapsed and clamped rows stay in the page behind their buttons", async () => {
		const lines = Array.from({ length: 40 }, (_, i) => `const v${i} = ${i};`);
		const out = await html({ lang: "ts", code: lines.join("\n") });
		expect(out).toContain("data-more");
		expect(out).toContain("Show 10 more lines");
		expect(out).toContain("<div hidden>");
		const folded = await html({
			lang: "ts",
			code: ["// !collapse(1:3)", ...lines.slice(0, 5)].join("\n"),
		});
		expect(folded).toContain("data-fold");
		expect(folded).toContain("3 lines");
	});
});

describe("base url swap", () => {
	test("a base fence wraps the hosted origin and credential for the switch", async () => {
		const out = await html({
			lang: "sh",
			meta: "base",
			code: 'curl https://api.secondlayer.tools/v1/streams/tip -H "Authorization: Bearer $SECONDLAYER_API_KEY"',
		});
		expect(out).toMatch(
			/<span data-swap="0"><span[^>]*>https:\/\/api.secondlayer.tools<\/span><\/span>/,
		);
		expect(out).toMatch(
			/<span data-swap="1"><span[^>]*>\$SECONDLAYER_API_KEY<\/span><\/span>/,
		);
	});

	test("a fence without the option stays plain", async () => {
		const out = await html({
			lang: "sh",
			code: "curl https://api.secondlayer.tools/v1/streams/tip",
		});
		expect(out).not.toContain("data-swap");
	});
});

describe("figure variant", () => {
	const source = [
		"await sl.streams.consume({",
		"  // !callout[/fromCursor/] null on the first run",
		"  fromCursor: db.load(),",
		"  // !mark[/ctx.cursor/] blue",
		"  // !callout[/ctx.cursor/] saved with the rows",
		"  save: ctx.cursor,",
		"});",
	].join("\n");

	test("callouts leave the block for the margin, keyed to their row and line number", async () => {
		const out = await html({ lang: "ts", variant: "figure", code: source });
		expect(out).not.toContain('class="co"');
		expect(out).toContain(
			'<p class="cf-note" style="--i:1"><b>2</b><span>null on the first run</span></p>',
		);
		expect(out).toContain('<p class="cf-note" style="--i:2"><b>3</b>');
		// Lines are numbered, and a noted row's number takes ink.
		expect(out).toContain('<span class="ln">1</span>');
		expect(out).toContain('class="row g noted"');
	});

	test("each callout marks its token, except one the author marked blue", async () => {
		const out = await html({ lang: "ts", variant: "figure", code: source });
		expect(out).toMatch(
			/<mark class="hi"><span[^>]*>fromCursor<\/span><\/mark>/,
		);
		expect(out).toContain('<mark class="act">');
		expect(out.match(/<mark class="hi">/g)).toHaveLength(1);
	});

	test("a figure without callouts is just the block, and docs keep inline callouts", async () => {
		const bare = await html({
			lang: "ts",
			variant: "figure",
			code: "const a = 1;",
		});
		expect(bare).not.toContain('class="cf-notes"');
		const docs = await html({
			lang: "ts",
			code: "// !callout[/send/] note\nsend();",
		});
		expect(docs).toContain('class="co"');
		expect(docs).not.toContain("cf-note");
	});

	test("a figure does not clamp long source behind Show more", async () => {
		const lines = Array.from({ length: 40 }, (_, i) => `const v${i} = ${i};`);
		const out = await html({
			lang: "ts",
			variant: "figure",
			code: lines.join("\n"),
		});
		expect(out).not.toContain("data-more");
	});

	test("options that move rows off their notes are refused", async () => {
		await expect(
			html({
				lang: "ts",
				variant: "figure",
				meta: "wrap",
				code: "const a = 1;",
			}),
		).rejects.toThrow("figures take no");
	});
});
