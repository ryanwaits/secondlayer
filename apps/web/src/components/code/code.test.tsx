import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LADDER_HEXES } from "@/lib/syntax-theme";
import { renderToStaticMarkup } from "react-dom/server";
import { Code, type CodeProps } from "./code";
import { KEY_CONTROLS } from "./handlers";

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

describe("error handler", () => {
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

describe("tips", () => {
	const tips = ["sl.streams.tip", "/v1/streams/tip", "ConsumerBatchContext"];

	test("a hand tip wraps the token once and carries its text in an attribute", async () => {
		const out = await html({
			lang: "ts",
			code: [
				"// !tip[/consume/] Reads one page.",
				"sl.consume(); consume();",
			].join("\n"),
		});
		expect(out.match(/class="tip"/g)).toHaveLength(1);
		expect(out).toContain('tabindex="0"');
		expect(out).toContain("data-tip=");
		expect(out).toContain("Reads one page.");
		// The words ride in the attribute, so Copy (which reads text) is unchanged.
		expect(out.replace(/<[^>]*>/g, "")).not.toContain("Reads one page.");
	});

	test("a hand tip needs a token and its text", async () => {
		await expect(html({ lang: "ts", code: "// !tip\nx" })).rejects.toThrow(
			"!tip needs",
		);
		await expect(html({ lang: "ts", code: "// !tip[/x/]\nx" })).rejects.toThrow(
			"!tip needs",
		);
	});

	test("a name the page allowed is tipped, once, with its summary", async () => {
		const out = await html({
			lang: "ts",
			tips,
			code: "await sl.streams.tip();\nawait sl.streams.tip();",
		});
		expect(out.match(/class="tip"/g)).toHaveLength(1);
		expect(out).toContain("data-tip=");
		expect(out).toContain("&quot;kind&quot;:&quot;method&quot;");
	});

	test("a name the page did not allow is plain text", async () => {
		const none = await html({ lang: "ts", code: "await sl.streams.tip();" });
		expect(none).not.toContain('class="tip"');
		const other = await html({
			lang: "ts",
			tips: ["ConsumerBatchContext"],
			code: "await sl.streams.tip();",
		});
		expect(other).not.toContain('class="tip"');
	});

	test("an endpoint path in a command gets a tooltip, not a link", async () => {
		const out = await html({
			lang: "sh",
			tips,
			code: 'curl "$SECONDLAYER_API_URL/v1/streams/tip"',
		});
		expect(out).toContain('class="tip"');
		expect(out).toContain("&quot;kind&quot;:&quot;endpoint&quot;");
		expect(out).not.toContain("<a ");
	});

	test("output is never tipped", async () => {
		const out = await html({
			lang: "text",
			tips,
			code: "GET /v1/streams/tip",
		});
		expect(out).not.toContain('class="tip"');
	});

	test("a name a callout points at is plain on every line of the block", async () => {
		const out = await html({
			lang: "ts",
			tips,
			code: [
				"import type { ConsumerBatchContext } from 'x';",
				"// !callout[/ConsumerBatchContext/] the shape",
				"let a: ConsumerBatchContext;",
			].join("\n"),
		});
		expect(out).not.toContain('class="tip"');
	});

	test("a line with a comment, a mark or a callout is never tipped automatically", async () => {
		for (const code of [
			"await sl.streams.tip(); // tip",
			"// !mark[/await/]\nawait sl.streams.tip();",
			"// !callout[/await/] note\nawait sl.streams.tip();",
		])
			expect(await html({ lang: "ts", tips, code })).not.toContain(
				'class="tip"',
			);
	});

	test("a ref line still tips: refs are plumbing, not explanation", async () => {
		const out = await html({
			lang: "ts",
			tips,
			code: "// !ref[/params/] params\nfunction f(params: ConsumerBatchContext) {}",
		});
		expect(out).toContain('class="tip"');
	});

	test("a mark on the token wins over an automatic tip", async () => {
		const out = await html({
			lang: "ts",
			tips,
			code: "// !mark[/ConsumerBatchContext/]\nlet a: ConsumerBatchContext;",
		});
		expect(out).not.toContain('class="tip"');
		expect(out).toContain('<mark class="hi">');
	});

	test("a hand tip beats an automatic one for the same line", async () => {
		const out = await html({
			lang: "ts",
			tips,
			code: "// !tip[/a/] mine\nlet a: ConsumerBatchContext;",
		});
		expect(out.match(/class="tip"/g)).toHaveLength(1);
		expect(out).toContain("mine");
	});

	test("with tips present, Copy's text is the plain source", async () => {
		const out = await html({
			lang: "ts",
			tips,
			code: "let a: ConsumerBatchContext;",
		});
		expect(out.replace(/<[^>]*>/g, "")).toContain(
			"let a: ConsumerBatchContext;",
		);
		expect(out.replace(/<[^>]*>/g, "")).not.toContain("kind");
	});

	test("!focus and !link are no longer annotations", async () => {
		const { ANNOTATION_NAMES } = await import("@/lib/code/annotations");
		expect(ANNOTATION_NAMES).not.toContain("focus");
		expect(ANNOTATION_NAMES).not.toContain("link");
		const out = await html({ lang: "ts", code: "// !focus\nconst a = 1;" });
		expect(out).not.toContain("dim");
		expect(out).not.toContain("data-unfocus");
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
			/<span class="ph-no-capture" data-key-slot data-swap="1"><span[^>]*>\$SECONDLAYER_API_KEY<\/span><\/span>/,
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
			'<p class="cf-note" style="--i:1" data-note="0"><b>2</b><span>null on the first run</span></p>',
		);
		expect(out).toContain(
			'<p class="cf-note" style="--i:2" data-note="1"><b>3</b>',
		);
		// A noted row carries its note's ordinal, so hovering its token lights the note.
		expect(out).toContain('class="row g noted" data-note="1"');
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
		// A caret and the words: no box.
		expect(docs).toContain('<span class="co-caret">^</span>note');
		expect(docs).not.toContain("co-box");
		expect(docs).not.toContain("<svg");
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

describe("docs key slots", () => {
	const curl =
		'curl https://api.secondlayer.tools/v1/streams/tip -H "Authorization: Bearer $SECONDLAYER_API_KEY"';

	test("a copyable block naming the key variable gets hidden controls and a blocked slot", async () => {
		const out = await html({ lang: "sh", title: "tip", code: curl });
		expect(out).toContain(KEY_CONTROLS);
		expect(KEY_CONTROLS).toContain("data-key-signin hidden");
		expect(KEY_CONTROLS).toContain("data-key-chip");
		expect(KEY_CONTROLS).toContain("data-use-key hidden>Fill in a docs key<");
		expect(out).toMatch(
			/<span class="ph-no-capture" data-key-slot><span[^>]*>\$SECONDLAYER_API_KEY<\/span><\/span>/,
		);
	});

	test("an SDK sample reading the key from the environment gets a quoted slot", async () => {
		const out = await html({
			lang: "ts",
			title: "client.ts",
			code: "const sl = new SecondLayer({ apiKey: process.env.SECONDLAYER_API_KEY });",
		});
		expect(out).toContain("data-use-key hidden");
		expect(out).toContain("data-key-slot data-quote>");
	});

	test("a bare block floats the control beside Copy", async () => {
		const out = await html({ lang: "sh", code: curl });
		expect(out).toContain('class="cb bare key"');
		expect(out).toContain("data-use-key hidden");
	});

	test("a block without the variable has neither control nor slot", async () => {
		const out = await html({
			lang: "sh",
			title: "tip",
			code: "curl https://api.secondlayer.tools/v1/streams/tip",
		});
		expect(out).not.toContain("data-use-key");
		expect(out).not.toContain("data-key-slot");
	});

	test("output and nocopy blocks never offer a key", async () => {
		expect(
			await html({ lang: "text", code: "$ echo $SECONDLAYER_API_KEY\nok" }),
		).not.toContain("data-use-key");
		expect(
			await html({ lang: "sh", meta: "nocopy", code: curl }),
		).not.toContain("data-use-key");
	});

	test("the server never renders a key value", async () => {
		const out = await html({ lang: "sh", title: "tip", code: curl });
		expect(out).not.toMatch(/sk-sl_/);
	});
});
