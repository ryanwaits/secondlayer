import type { HighlighterCore } from "shiki/core";
import { monotonePurple, monotonePurpleDark } from "./syntax-theme";

/**
 * Client-side counterpart to `highlight.ts` (server-only), for the delivery
 * card's payload/response/headers panels. Loaded by dynamic `import()` the
 * first time a card opens — never in the page's initial bundle.
 *
 * `shiki/core` + `shiki/engine/javascript` avoids the ~2MB oniguruma wasm
 * engine the full `shiki` package pulls in, and `@shikijs/langs/json` +
 * `/html` load only the two languages this card ever shows, instead of every
 * language `shiki/langs` bundles.
 */

let highlighterPromise: Promise<HighlighterCore> | null = null;

async function getHighlighter(): Promise<HighlighterCore> {
	if (!highlighterPromise) {
		highlighterPromise = (async () => {
			const [
				{ createHighlighterCore },
				{ createJavaScriptRegexEngine },
				json,
				html,
			] = await Promise.all([
				import("shiki/core"),
				import("shiki/engine/javascript"),
				import("@shikijs/langs/json").then((m) => m.default),
				import("@shikijs/langs/html").then((m) => m.default),
			]);
			return createHighlighterCore({
				themes: [monotonePurple, monotonePurpleDark],
				langs: [json, html],
				engine: createJavaScriptRegexEngine(),
			});
		})();
	}
	return highlighterPromise;
}

/** Pretty-printed, dual-theme HTML for the delivery card's code panels. The
 *  same `themes: {light, dark}` shape `highlight.ts` uses, so the existing
 *  `.shiki` dark-mode CSS applies without change. */
export async function highlightClient(
	code: string,
	lang: "json" | "html" = "json",
): Promise<string> {
	const highlighter = await getHighlighter();
	return highlighter.codeToHtml(code, {
		lang,
		themes: {
			light: "monotone-purple",
			dark: "monotone-purple-dark",
		},
	});
}
