import { createHighlighterCore } from "shiki/core";
import type { HighlighterCore, ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { secondlayer, secondlayerDark } from "./syntax-theme";

let highlighterPromise: Promise<HighlighterCore> | null = null;

/** Fine-grained Shiki with the JavaScript regex engine: no wasm, only our ten languages. */
function getHighlighter() {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighterCore({
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
	return highlighterPromise;
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

export type { ThemedToken };

/**
 * One array of tokens per source line. Both themes ride on each token as CSS
 * variables (`--shiki-light`, `--shiki-dark`), so a single set of spans serves
 * either color scheme. Unsupported languages come back as one plain token per
 * line so callers never branch on them.
 */
export async function tokenize(
	code: string,
	lang = "typescript",
): Promise<ThemedToken[][]> {
	const normalized = normalizeLang(lang);
	if (normalized === "text") {
		return code
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

/** Dual-theme Shiki HTML, for the two surfaces that need Shiki's own markup: the agent prompt card and the writing hero art. Code blocks go through `<Code>`. */
export async function highlight(
	code: string,
	lang = "typescript",
): Promise<string> {
	const normalized = normalizeLang(lang);
	const highlighter = await getHighlighter();
	return highlighter.codeToHtml(code, {
		lang: normalized === "text" ? "bash" : normalized,
		themes: { light: "secondlayer", dark: "secondlayer-dark" },
	});
}
