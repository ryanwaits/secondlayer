"use client";

import { useCallback, useState } from "react";

interface CodeCardProps {
	code: string;
	filename?: string;
	lang?: string;
}

export function CodeCard({ code, filename, lang = "TypeScript" }: CodeCardProps) {
	const [copied, setCopied] = useState(false);

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
			<pre className="tool-code-body">
				<code>{code}</code>
			</pre>
			<div className="tool-code-actions">
				<button type="button" className="tool-btn primary">
					Deploy Now
				</button>
				<button type="button" className="tool-btn ghost" onClick={handleCopy}>
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
		</div>
	);
}
