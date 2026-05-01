"use client";

import { highlightCode } from "@/components/command-palette/actions";
import { CopyButton } from "@/components/copy-button";
import { useEffect, useState } from "react";

const CODE_PREVIEW_HEIGHT = 179;

export function AgentPromptBlock({
	title,
	code,
	lang = "markdown",
	collapsible = true,
}: {
	title: string;
	code: string;
	lang?: string;
	collapsible?: boolean;
}) {
	const [html, setHtml] = useState<string | null>(null);
	const [expanded, setExpanded] = useState(false);

	useEffect(() => {
		let cancelled = false;
		highlightCode(code, lang).then((result) => {
			if (!cancelled) setHtml(result);
		});
		return () => {
			cancelled = true;
		};
	}, [code, lang]);

	const needsCollapse = collapsible && code.split("\n").length > 10;
	const isCollapsed = needsCollapse && !expanded;

	return (
		<div className="agent-prompt">
			<div className="agent-prompt-header">
				{title && <span className="agent-prompt-title">{title}</span>}
			</div>

			<div className="agent-prompt-code code-block-wrapper">
				<CopyButton code={code} />
				<div
					className={`agent-prompt-scroll ${isCollapsed ? "agent-prompt-collapsed" : ""}`}
					style={isCollapsed ? { maxHeight: CODE_PREVIEW_HEIGHT } : undefined}
				>
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
			{needsCollapse && !expanded && (
				<button
					type="button"
					className="agent-prompt-toggle"
					onClick={() => setExpanded(true)}
				>
					Show all
				</button>
			)}
		</div>
	);
}
