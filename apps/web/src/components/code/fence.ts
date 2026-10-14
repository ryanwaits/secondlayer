import { type ReactNode, isValidElement } from "react";

export type Fence = {
	code: string;
	/** The language as authored (`ts`, `bash`). */
	lang: string;
	/** The rest of the info string: title and options. */
	meta?: string;
	/** A title the info string cannot spell. */
	title?: string;
	/** `false` when a `<Code>` opted out of automatic links. */
	links?: boolean;
};

type CodeElement = {
	props?: { className?: string; children?: ReactNode; "data-meta"?: string };
};

/** A fence from MDX's `<code class="language-x" data-meta="…">`; remark-code-meta puts the info string on `data-meta`. */
export function fenceFromCode(codeEl: CodeElement | undefined): Fence | null {
	if (!codeEl?.props) return null;
	return {
		code: String(codeEl.props.children ?? ""),
		lang:
			/language-(\w[\w.-]*)/.exec(codeEl.props.className ?? "")?.[1] ?? "text",
		meta: codeEl.props["data-meta"],
	};
}

type FenceProps = {
	children?: CodeElement;
	/** Set when the element is a `<Code>` itself. */
	code?: string;
	lang?: string;
	meta?: string;
	title?: string;
	links?: boolean;
};

/** A fence from either shape it travels in: an MDX `<pre>` or a `<Code code lang meta>` element a component built. */
export function fenceOf(node: ReactNode): Fence | null {
	if (!isValidElement<FenceProps>(node)) return null;
	const { code, lang, meta, title, links, children } = node.props;
	if (typeof code === "string")
		return { code, lang: lang ?? "text", meta, title, links };
	return fenceFromCode(children);
}
