import { createHighlighterCore } from "shiki/core";
import type { HighlighterCore, ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { secondlayer, secondlayerDark } from "./syntax-theme";

/** Next bundles the server's startup hook and each route separately, so this
 *  module can load more than once per process. Keeping the highlighter on
 *  `globalThis` lets the startup warm-up serve the routes' renders. */
const HIGHLIGHTER_KEY = Symbol.for("secondlayer.highlighter");
const shared = globalThis as unknown as {
	[HIGHLIGHTER_KEY]?: Promise<HighlighterCore>;
};

/** Fine-grained Shiki with the JavaScript regex engine: no wasm, only our ten languages. */
function getHighlighter(): Promise<HighlighterCore> {
	if (!shared[HIGHLIGHTER_KEY]) {
		shared[HIGHLIGHTER_KEY] = createHighlighterCore({
			themes: [secondlayer, secondlayerDark],
			langs: [
				import("@shikijs/langs/typescript"),
				import("@shikijs/langs/tsx"),
				import("@shikijs/langs/javascript"),
				import("@shikijs/langs/bash"),
				import("@shikijs/langs/json"),
				import("@shikijs/langs/sql"),
				import("@shikijs/langs/markdown"),
				import("@shikijs/langs/toml"),
				import("@shikijs/langs/clarity"),
				import("@shikijs/langs/solidity"),
			],
			engine: createJavaScriptRegexEngine(),
		});
	}
	return shared[HIGHLIGHTER_KEY] as Promise<HighlighterCore>;
}

const LANG_ALIASES: Record<string, string> = {
	sh: "bash",
	shell: "bash",
	shellscript: "bash",
	curl: "bash",
	zsh: "bash",
	js: "javascript",
	ts: "typescript",
	node: "javascript",
	"node.js": "javascript",
	nodejs: "javascript",
	sol: "solidity",
};

const SUPPORTED_LANGS = new Set([
	"typescript",
	"tsx",
	"javascript",
	"bash",
	"json",
	"sql",
	"markdown",
	"toml",
	"clarity",
	"solidity",
]);

export function normalizeLang(lang: string): string {
	const lower = lang.toLowerCase();
	const aliased = LANG_ALIASES[lower] ?? lower;
	return SUPPORTED_LANGS.has(aliased) ? aliased : "text";
}

export const MAX_HIGHLIGHT_CHARS = 32_768;

const HTML_ESCAPE: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch] ?? ch);
}

export type { ThemedToken };

export async function tokenize(
	code: string,
	lang = "typescript",
): Promise<ThemedToken[][]> {
	const normalized = normalizeLang(lang);
	if (normalized === "text" || code.length > MAX_HIGHLIGHT_CHARS) {
		const bounded =
			code.length > MAX_HIGHLIGHT_CHARS
				? code.slice(0, MAX_HIGHLIGHT_CHARS)
				: code;
		return bounded
			.split("\n")
			.map((content) => [
				{ content, offset: 0, htmlStyle: {} } satisfies ThemedToken,
			]);
	}
	const highlighter = await getHighlighter();
	return highlighter.codeToTokens(code, {
		lang: normalized,
		themes: { light: "secondlayer", dark: "secondlayer-dark" },
		defaultColor: false,
	}).tokens;
}

export async function highlight(
	code: string,
	lang = "typescript",
): Promise<string> {
	if (code.length > MAX_HIGHLIGHT_CHARS) {
		return `<pre class="shiki"><code>${escapeHtml(code.slice(0, MAX_HIGHLIGHT_CHARS))}</code></pre>`;
	}
	const normalized = normalizeLang(lang);
	const highlighter = await getHighlighter();
	return highlighter.codeToHtml(code, {
		lang: normalized === "text" ? "bash" : normalized,
		themes: { light: "secondlayer", dark: "secondlayer-dark" },
	});
}
