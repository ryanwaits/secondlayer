import { CodeBlock } from "@/components/code-block";
import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import type { ReactNode } from "react";

/** Fenced code block: MDX renders <pre><code class="language-x">…</code></pre>.
 *  Pull the language + source off the inner <code> and hand it to our Shiki
 *  CodeBlock (same highlight() + copy button the rest of the app uses). */
function MdxPre({ children }: { children?: ReactNode }) {
	const codeEl = children as
		| { props?: { className?: string; children?: ReactNode } }
		| undefined;
	const className = codeEl?.props?.className ?? "";
	const lang = /language-(\w[\w.-]*)/.exec(className)?.[1] ?? "text";
	const code = String(codeEl?.props?.children ?? "");
	return <CodeBlock code={code} lang={lang} />;
}

/** Internal links use next/link; external open in a new tab. Both get .ln. */
function MdxLink({
	href = "",
	children,
}: {
	href?: string;
	children?: ReactNode;
}) {
	if (href.startsWith("/") || href.startsWith("#")) {
		return (
			<Link href={href} className="ln">
				{children}
			</Link>
		);
	}
	return (
		<a href={href} className="ln" target="_blank" rel="noreferrer">
			{children}
		</a>
	);
}

export function useMDXComponents(components: MDXComponents): MDXComponents {
	return {
		pre: MdxPre,
		a: MdxLink,
		...components,
	};
}
