import { createHighlighter, type Highlighter } from "shiki";
import { monotonePurple } from "./syntax-theme";

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [monotonePurple],
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
    theme: "monotone-purple",
  });
}
