import { CodeBlock } from "@/components/code-block";
import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import type { ReactNode } from "react";

/** Fenced code block: MDX renders <pre><code class="language-x">…</code></pre>.
 *  Pull the language + source off the inner <code> and hand it to our Shiki
 *  CodeBlock — the same component marketing article pages use. */
function MdxPre({ children }: { children?: ReactNode }) {
	const codeEl = children as
		| { props?: { className?: string; children?: ReactNode } }
		| undefined;
	const className = codeEl?.props?.className ?? "";
	const lang = /language-(\w[\w.-]*)/.exec(className)?.[1] ?? "text";
	const code = String(codeEl?.props?.children ?? "");
	return <CodeBlock code={code} lang={lang} />;
}

/** Internal links use next/link; external open in a new tab. Styling comes
 *  from `.docs-article a` (mirrors marketing `.prose a`). */
function MdxLink({
	href = "",
	children,
}: { href?: string; children?: ReactNode }) {
	if (href.startsWith("/") || href.startsWith("#")) {
		return <Link href={href}>{children}</Link>;
	}
	return (
		<a href={href} target="_blank" rel="noreferrer">
			{children}
		</a>
	);
}

/** Page title — marketing's `.page-title` (Public Sans, 15px/500). */
function MdxH1({ children }: { children?: ReactNode }) {
	return <h1 className="page-title">{children}</h1>;
}

/** A self-link wrapping heading text: clicking sets the URL hash and scrolls,
 *  and a `#` affordance appears on hover (see `.heading-anchor` in globals). */
function HeadingAnchor({
	id,
	children,
}: { id?: string; children?: ReactNode }) {
	if (!id) return <>{children}</>;
	return (
		<a
			href={`#${id}`}
			className="heading-anchor"
			aria-label="Link to this section"
		>
			{children}
		</a>
	);
}

/** Section heading — marketing's text-over-a-rule treatment. The id stays on
 *  the <h2> (not the wrap) so rehype-slug anchors + the scrollspy TOC work. */
function MdxH2({ id, children }: { id?: string; children?: ReactNode }) {
	return (
		<div className="section-heading-wrap">
			<hr />
			<h2 id={id} className="section-heading">
				<HeadingAnchor id={id}>{children}</HeadingAnchor>
			</h2>
		</div>
	);
}

/** Subsection heading — no rule, but still a deep-linkable permalink. */
function MdxH3({ id, children }: { id?: string; children?: ReactNode }) {
	return (
		<h3 id={id}>
			<HeadingAnchor id={id}>{children}</HeadingAnchor>
		</h3>
	);
}

export function useMDXComponents(components: MDXComponents): MDXComponents {
	return {
		pre: MdxPre,
		a: MdxLink,
		h1: MdxH1,
		h2: MdxH2,
		h3: MdxH3,
		...components,
	};
}
