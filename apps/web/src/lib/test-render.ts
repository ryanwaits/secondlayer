import type { ReactNode } from "react";
import { prerender } from "react-dom/static";

/**
 * A page as static markup, async server components included.
 * `renderToStaticMarkup` cannot await them; `prerender` can, and marks text
 * boundaries with comments that this strips so the markup reads the same.
 */
export async function renderAsync(node: ReactNode): Promise<string> {
	const { prelude } = await prerender(node);
	return (await new Response(prelude).text()).replaceAll("<!-- -->", "");
}
