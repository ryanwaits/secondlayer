// Server-only: pulls in the highlighter.

let highlighterWarmed = false;

/**
 * Loads the highlighter's grammars and themes, once per instance. Called after
 * a response has gone out, so the instance's first request doesn't wait on it
 * and later pages that render code (webhook and subgraph detail) find it warm.
 */
export function warmHighlighter(): void {
	if (highlighterWarmed) return;
	highlighterWarmed = true;
	void import("@/components/code/code")
		.then(({ renderCode }) =>
			renderCode({ code: "const warm = 1;", lang: "ts" }),
		)
		.catch(() => {});
}
