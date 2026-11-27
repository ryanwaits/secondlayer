"use server";

import { MAX_HIGHLIGHT_CHARS, highlight } from "@/lib/highlight";

export async function highlightCode(
	code: string,
	lang: string,
): Promise<string> {
	if (typeof code !== "string" || typeof lang !== "string") {
		return "";
	}
	return highlight(code.slice(0, MAX_HIGHLIGHT_CHARS + 1), lang);
}
