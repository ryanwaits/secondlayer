import { Code } from "@/components/code/code";
import { CodeSteps, Step } from "@/components/code/code-steps";
import { CodeTabs } from "@/components/code/code-tabs";
import { fenceFromCode } from "@/components/code/fence";
import { FocusLink, Mention, Pick, Tip } from "@/components/code/prose";
import { Banner, Callout } from "@/components/docs/callout";
import { Checks } from "@/components/docs/checks";
import { Cmd } from "@/components/docs/cmd";
import { Fork, ForkPath } from "@/components/docs/fork";
import { Seam } from "@/components/docs/seam";
import { Stack } from "@/components/docs/stack";
import { Steps } from "@/components/docs/steps";
import { Yields } from "@/components/docs/yields";
import { parseFenceOptions } from "@/lib/code/annotations";
import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";

function MdxPre({ children }: { children?: ReactNode }) {
	const fence = fenceFromCode(children as Parameters<typeof fenceFromCode>[0]);
	if (!fence) return null;
	const { figure } = parseFenceOptions(`${fence.lang} ${fence.meta ?? ""}`);
	return <Code {...fence} variant={figure ? "figure" : undefined} />;
}

const ENDPOINT_RE = /\/(v1|api)\b/;
const METHOD_RE = /^(GET|POST|PUT|PATCH|DELETE)\s/;
function MdxCode({ children }: { children?: ReactNode }) {
	const text = typeof children === "string" ? children : "";
	const isApi = ENDPOINT_RE.test(text) || METHOD_RE.test(text);
	return <code className={isApi ? "code-api" : undefined}>{children}</code>;
}

function MdxLink({
	href = "",
	title,
	children,
	...rest
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
	if (href.startsWith("hover:"))
		return <Mention name={href.slice("hover:".length)}>{children}</Mention>;
	if (href.startsWith("focus:"))
		return <FocusLink name={href.slice("focus:".length)}>{children}</FocusLink>;
	if (href === "tip") return <Tip text={title}>{children}</Tip>;
	if (href.startsWith("tip:"))
		throw new Error(`tip: links were replaced by [text](tip "words"): ${href}`);
	if (href.startsWith("/") || href.startsWith("#")) {
		return (
			<Link href={href} {...rest}>
				{children}
			</Link>
		);
	}
	return (
		<a href={href} target="_blank" rel="noreferrer">
			{children}
		</a>
	);
}

function MdxH1({ children }: { children?: ReactNode }) {
	return <h1 className="page-title">{children}</h1>;
}

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

function MdxH3({ id, children }: { id?: string; children?: ReactNode }) {
	return (
		<h3 id={id}>
			<HeadingAnchor id={id}>{children}</HeadingAnchor>
		</h3>
	);
}

function MdxH4({ id, children }: { id?: string; children?: ReactNode }) {
	return (
		<h4 id={id}>
			<HeadingAnchor id={id}>{children}</HeadingAnchor>
		</h4>
	);
}

function MdxTable({ children }: { children?: ReactNode }) {
	return (
		<div className="docs-table">
			<table>{children}</table>
		</div>
	);
}

export function useMDXComponents(components: MDXComponents): MDXComponents {
	return {
		pre: MdxPre,
		table: MdxTable,
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
		Stack,
		Checks,
		Cmd,
		Yields,
		Seam,
		Steps,
		Fork,
		ForkPath,
		...components,
	};
}
