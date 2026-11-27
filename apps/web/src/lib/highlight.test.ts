import { describe, expect, test } from "bun:test";
import { highlightCode } from "../components/command-palette/actions";
import { MAX_HIGHLIGHT_CHARS, highlight, tokenize } from "./highlight";

describe("highlight size cap", () => {
	test("falls back to escaped pre/code when input exceeds MAX_HIGHLIGHT_CHARS", async () => {
		const prefix = `<script>alert("xss"&'1')</script>`;
		const sentinel = "SENTINEL_AFTER_CAP";
		const oversized = `${prefix}${"a".repeat(MAX_HIGHLIGHT_CHARS)}${sentinel}`;

		const started = performance.now();
		const html = await highlight(oversized, "typescript");
		const elapsed = performance.now() - started;

		expect(html.startsWith('<pre class="shiki"><code>')).toBe(true);
		expect(html.endsWith("</code></pre>")).toBe(true);
		expect(html).toContain(
			"&lt;script&gt;alert(&quot;xss&quot;&amp;&#39;1&#39;)&lt;/script&gt;",
		);
		expect(html).not.toContain("<script>");
		expect(html).not.toContain(sentinel);
		expect(elapsed).toBeLessThan(200);
	});

	test("tokenize returns plain bounded tokens when input exceeds MAX_HIGHLIGHT_CHARS", async () => {
		const sentinel = "AFTER_CAP";
		const oversized = `line1\n${"x".repeat(MAX_HIGHLIGHT_CHARS)}\n${sentinel}`;

		const tokens = await tokenize(oversized, "typescript");

		expect(tokens.length).toBe(2);
		expect(tokens[0]).toEqual([{ content: "line1", offset: 0, htmlStyle: {} }]);
		expect(tokens[1]?.[0]?.htmlStyle).toEqual({});
		expect(tokens[1]?.[0]?.content.length).toBe(MAX_HIGHLIGHT_CHARS - 6);
		expect(tokens.flat().some((t) => t.content.includes(sentinel))).toBe(false);
	});

	test("highlightCode guards non-string args and caps oversized input", async () => {
		expect(await highlightCode(null as unknown as string, "ts")).toBe("");
		expect(await highlightCode("const x = 1;", null as unknown as string)).toBe(
			"",
		);

		const html = await highlightCode(
			`<img onerror=1>${"z".repeat(MAX_HIGHLIGHT_CHARS + 500)}`,
			"typescript",
		);
		expect(html.startsWith('<pre class="shiki"><code>&lt;img')).toBe(true);
		expect(html).not.toContain("<img");
	});
});
