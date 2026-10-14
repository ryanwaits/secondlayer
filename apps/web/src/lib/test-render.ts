import {
	Children,
	type ReactElement,
	type ReactNode,
	isValidElement,
} from "react";
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

/** What a browser would put in FormData for the radios in this markup:
 *  field name -> the checked value. Static markup has no DOM to ask. */
export function checkedRadios(html: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const tag of html.match(/<input[^>]*type="radio"[^>]*>/g) ?? []) {
		const name = tag.match(/name="([^"]*)"/)?.[1];
		const value = tag.match(/value="([^"]*)"/)?.[1];
		if (name && value !== undefined && /\schecked=""/.test(tag)) {
			out[name] = value;
		}
	}
	return out;
}

/** The props a form control carries that tests read back. */
export type ControlProps = {
	children?: ReactNode;
	value?: string;
	checked?: boolean;
	onChange?: (...args: string[]) => void;
};

/** Every element of a component's returned tree with the given tag or
 *  component. Walks elements only, so call function components directly to
 *  see inside them. */
export function findElements(
	node: ReactNode,
	type: ReactElement["type"],
): ReactElement<ControlProps>[] {
	if (!isValidElement<ControlProps>(node)) return [];
	return [
		...(node.type === type ? [node] : []),
		...Children.toArray(node.props.children).flatMap((c) =>
			findElements(c, type),
		),
	];
}
