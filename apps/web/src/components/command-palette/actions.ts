"use server";

import { highlight } from "@/lib/highlight";

export async function highlightCode(code: string, lang: string): Promise<string> {
  return highlight(code, lang);
}
