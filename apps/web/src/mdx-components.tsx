import { Code } from "@/components/code/code";
import { CodeSteps, Step } from "@/components/code/code-steps";
import { CodeTabs } from "@/components/code/code-tabs";
import { fenceFromCode } from "@/components/code/fence";
import { FocusLink, Mention, Pick, Tip } from "@/components/code/prose";
import { Banner, Callout } from "@/components/docs/callout";
import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import type { ReactNode } from "react";

/** Fenced code block: MDX renders <pre><code class="language-x" data-meta="…">…</code></pre>.
 *  Pull the language, the fence options (remark-code-meta) and the source off
 *  the inner <code> and hand them to the one `<Code>` renderer. */
function MdxPre({ children }: { children?: ReactNode }) {
	const fence = fenceFromCode(children as Parameters<typeof fenceFromCode>[0]);
	return fence ? <Code {...fence} /> : null;
}

/** Inline `code` styling rule: API endpoints/routes get the branded blue
 *  chip (`.code-api`); everything else (params, types, symbols, values,
 *  status codes, commands) stays the neutral keycap. One regex = the rule,
 *  applied across every docs page with no manual tagging. Fenced code never
 *  reaches here — it's intercepted by MdxPre. */
const ENDPOINT_RE = /\/(v1|api)\b/;
const METHOD_RE = /^(GET|POST|PUT|PATCH|DELETE)\s/;
function MdxCode({ children }: { children?: ReactNode }) {
	const text = typeof children === "string" ? children : "";
	const isApi = ENDPOINT_RE.test(text) || METHOD_RE.test(text);
	return <code className={isApi ? "code-api" : undefined}>{children}</code>;
}

/** Internal links use next/link; external open in a new tab. Styling comes
 *  from `.docs-article a` (mirrors marketing `.prose a`). `hover:name` and
 *  `focus:name` are not links: they point at a `!ref` in the same section.
 *  `tip:/docs/page#section` is not a link either: it explains a word in place. */
function MdxLink({
	href = "",
	children,
}: { href?: string; children?: ReactNode }) {
	if (href.startsWith("hover:"))
		return <Mention name={href.slice("hover:".length)}>{children}</Mention>;
	if (href.startsWith("focus:"))
		return <FocusLink name={href.slice("focus:".length)}>{children}</FocusLink>;
	if (href.startsWith("tip:"))
		return <Tip href={href.slice("tip:".length)}>{children}</Tip>;
	if (href.startsWith("/") || href.startsWith("#")) {
		return <Link href={href}>{children}</Link>;
	}
	return (
		<a href={href} target="_blank" rel="noreferrer">
			{children}
		</a>
	);
}

/** Page title — marketing's `.page-title` (Geist, 15px/500). */
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

/** A subsection's own subsection, same permalink. */
function MdxH4({ id, children }: { id?: string; children?: ReactNode }) {
	return (
		<h4 id={id}>
			<HeadingAnchor id={id}>{children}</HeadingAnchor>
		</h4>
	);
}

export function useMDXComponents(components: MDXComponents): MDXComponents {
	return {
		pre: MdxPre,
		code: MdxCode,
		a: MdxLink,
		h1: MdxH1,
		h2: MdxH2,
		h3: MdxH3,
		h4: MdxH4,
		Callout,
		Banner,
		CodeTabs,
		Pick,
		CodeSteps,
		Step,
		...components,
	};
}
