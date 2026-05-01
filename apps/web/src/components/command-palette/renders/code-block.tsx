"use client";

import { useEffect, useState } from "react";
import { highlightCode } from "../actions";

interface PaletteCodeBlockProps {
	code: string;
	lang?: string;
	title?: string;
}

export function PaletteCodeBlock({ code, lang, title }: PaletteCodeBlockProps) {
	const [html, setHtml] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		let cancelled = false;
		if (lang) {
			highlightCode(code, lang).then((result) => {
				if (!cancelled) setHtml(result);
			});
		}
		return () => {
			cancelled = true;
		};
	}, [code, lang]);

	const copyToClipboard = () => {
		navigator.clipboard.writeText(code);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="palette-code">
			{html ? (
				<div
					className="palette-code-block"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: pre-rendered shiki HTML for syntax highlighting
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			) : (
				<pre className="palette-code-block palette-code-raw">{code}</pre>
			)}
			<div className="palette-code-actions">
				<button type="button" className="palette-btn" onClick={copyToClipboard}>
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
		</div>
	);
}
