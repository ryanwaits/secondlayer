import { renderCode } from "@/components/code/code";
import type { CodeBlockInput, RenderedBlock } from "@/lib/code/blocks";

/** Renders TypeScript blocks with the docs code renderer. Renders only the
 *  text it's given, escaped by `renderCode`; reads no account data. */
export async function renderBlocks(
	blocks: readonly CodeBlockInput[],
): Promise<RenderedBlock[]> {
	const rendered = await Promise.all(
		blocks.map(({ code, title, lines }) =>
			renderCode({ code, lang: "ts", meta: `lines=${lines}`, title }),
		),
	);
	return rendered.map(({ className, copyable, html }) => ({
		className,
		copyable,
		html,
	}));
}
