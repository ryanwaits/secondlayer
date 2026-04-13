"use client";

import { highlightCode } from "@/components/command-palette/actions";
import { useCallback, useEffect, useState } from "react";

interface CodeCardProps {
	code: string;
	/** Pre-rendered highlighted HTML. If set, no client highlighting runs. */
	html?: string;
	filename?: string;
	lang?: string;
}

export function CodeCard({
	code,
	html: initialHtml,
	filename,
	lang = "typescript",
}: CodeCardProps) {
	const [copied, setCopied] = useState(false);
	const [html, setHtml] = useState<string | null>(initialHtml ?? null);

	useEffect(() => {
		if (initialHtml) return;
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
		<div className="tool-code-card">
			<div className="tool-code-header">
				<span>{filename ?? "generated.ts"}</span>
				<span style={{ opacity: 0.5 }}>{lang}</span>
			</div>
			<div className="tool-code-body">
				{html ? (
					<div dangerouslySetInnerHTML={{ __html: html }} />
				) : (
					<pre>
						<code>{code}</code>
					</pre>
				)}
			</div>
			<div className="tool-code-actions">
				<button type="button" className="tool-btn ghost" onClick={handleCopy}>
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
		</div>
	);
}
