import { type ReactNode, isValidElement } from "react";

export type Fence = {
	code: string;
	/** The language as authored (`ts`, `bash`). */
	lang: string;
	/** The rest of the info string: title and options. */
	meta?: string;
	/** A title the info string cannot spell. */
	title?: string;
	/** The names this block may tip automatically. */
	tips?: readonly string[];
};

type CodeElement = {
	props?: {
		className?: string;
		children?: ReactNode;
		"data-meta"?: string;
		"data-tips"?: string;
	};
};

/**
 * A fence from MDX's `<code class="language-x" data-meta="…">`; remark-code-meta
 * puts the info string on `data-meta`, and remark-code-tips the names the page
 * lets this block tip on `data-tips` (space separated).
 */
export function fenceFromCode(codeEl: CodeElement | undefined): Fence | null {
	if (!codeEl?.props) return null;
	return {
		code: String(codeEl.props.children ?? ""),
		lang:
			/language-(\w[\w.-]*)/.exec(codeEl.props.className ?? "")?.[1] ?? "text",
		meta: codeEl.props["data-meta"],
		tips: codeEl.props["data-tips"]?.split(" ").filter(Boolean),
	};
}

type FenceProps = {
	children?: CodeElement;
	/** Set when the element is a `<Code>` itself. */
	code?: string;
	lang?: string;
	meta?: string;
	title?: string;
	tips?: readonly string[];
};

/** A fence from either shape it travels in: an MDX `<pre>` or a `<Code code lang meta>` element a component built. */
export function fenceOf(node: ReactNode): Fence | null {
	if (!isValidElement<FenceProps>(node)) return null;
	const { code, lang, meta, title, tips, children } = node.props;
	if (typeof code === "string")
		return { code, lang: lang ?? "text", meta, title, tips };
	return fenceFromCode(children);
}
