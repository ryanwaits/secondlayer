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

/** The props a form control carries that tests read back. */
export type ControlProps = {
	children?: ReactNode;
	value?: string;
	checked?: boolean;
	onChange?: () => void;
};

/** Every element of a component's returned tree with the given tag. Walks
 *  elements only, so call function components directly to see inside them. */
export function findElements(
	node: ReactNode,
	tag: string,
): ReactElement<ControlProps>[] {
	if (!isValidElement<ControlProps>(node)) return [];
	return [
		...(node.type === tag ? [node] : []),
		...Children.toArray(node.props.children).flatMap((c) =>
			findElements(c, tag),
		),
	];
}
