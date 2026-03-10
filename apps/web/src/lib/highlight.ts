import { createHighlighter, type Highlighter } from "shiki";
import { monotonePurple, monotonePurpleDark } from "./syntax-theme";

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [monotonePurple, monotonePurpleDark],
      langs: ["typescript", "tsx", "javascript", "bash", "json", "sql"],
    });
  }
  return highlighterPromise;
}

export async function highlight(
  code: string,
  lang: string = "typescript"
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
