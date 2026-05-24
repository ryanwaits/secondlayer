"use client";

import { highlightCode } from "@/components/command-palette/actions";
import { useEffect, useState } from "react";
import { CopyButton } from "./copy-button";

/**
 * Client-side syntax-highlighted code block for the API sandbox.
 * Snippets are dynamic (they change with the form), so highlighting runs
 * lazily via the server action, debounced, with a plain-text fallback.
 */
export function SandboxCode({ code, lang }: { code: string; lang: string }) {
	const [html, setHtml] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		const timer = setTimeout(() => {
			highlightCode(code, lang)
				.then((res) => {
					if (!cancelled) setHtml(res);
				})
				.catch(() => {
					if (!cancelled) setHtml(null);
				});
		}, 120);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [code, lang]);

	return (
		<div className="code-block-wrapper">
			{html ? (
				// biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output from our trusted server action
				<div dangerouslySetInnerHTML={{ __html: html }} />
			) : (
				<pre className="code-block">
					<code>{code}</code>
				</pre>
			)}
			<CopyButton code={code} />
		</div>
	);
}
