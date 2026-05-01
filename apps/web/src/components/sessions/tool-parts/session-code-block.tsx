"use client";

import { highlightCode } from "@/components/command-palette/actions";
import { useCallback, useEffect, useState } from "react";

interface SessionCodeBlockProps {
	code: string;
	/** Pre-rendered highlighted HTML. If set, no client highlighting runs. */
	html?: string;
	lang?: string;
}

export function SessionCodeBlock({
	code,
	html: initialHtml,
	lang,
}: SessionCodeBlockProps) {
	const [html, setHtml] = useState<string | null>(initialHtml ?? null);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (initialHtml) {
			setHtml(initialHtml);
			return;
		}
		if (!lang) return;
		let cancelled = false;
		highlightCode(code, lang).then((result) => {
			if (!cancelled) setHtml(result);
		});
		return () => {
			cancelled = true;
		};
	}, [code, lang, initialHtml]);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(code);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [code]);

	return (
		<div className="session-code-block">
			<div className="session-code-header">
				{lang && <span className="session-code-lang">{lang}</span>}
				<button
					type="button"
					className="session-code-copy"
					onClick={handleCopy}
				>
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
			<div className="session-code-body">
				{html ? (
					// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki-highlighted code HTML
					<div dangerouslySetInnerHTML={{ __html: html }} />
				) : (
					<pre>
						<code>{code}</code>
					</pre>
				)}
			</div>
		</div>
	);
}
