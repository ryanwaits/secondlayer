import { type Highlighter, createHighlighter } from "shiki";
import { monotonePurple, monotonePurpleDark } from "./syntax-theme";

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter() {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighter({
			themes: [monotonePurple, monotonePurpleDark],
			langs: [
				"typescript",
				"tsx",
				"javascript",
				"bash",
				"json",
				"sql",
				"markdown",
			],
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
};

const SUPPORTED_LANGS = new Set([
	"typescript",
	"tsx",
	"javascript",
	"bash",
	"json",
	"sql",
	"markdown",
]);

export function normalizeLang(lang: string): string {
	const lower = lang.toLowerCase();
	const aliased = LANG_ALIASES[lower] ?? lower;
	return SUPPORTED_LANGS.has(aliased) ? aliased : "text";
}

export async function highlight(
	code: string,
	lang = "typescript",
): Promise<string> {
	const normalized = normalizeLang(lang);
	const highlighter = await getHighlighter();
	return highlighter.codeToHtml(code, {
		lang: normalized === "text" ? "bash" : normalized,
		themes: {
			light: "monotone-purple",
			dark: "monotone-purple-dark",
		},
	});
}
