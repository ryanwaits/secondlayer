"use client";

import { highlightCode } from "@/components/command-palette/actions";
import { CopyButton } from "@/components/copy-button";
import { useEffect, useState } from "react";

export interface CodeTab {
	label: string;
	lang: string;
	/** Code displayed in the block (may be masked) */
	code: string;
	/** Pre-rendered highlighted HTML. If set, no client highlighting runs. */
	html?: string;
	/** If set, CopyButton copies this instead of displayed code (for API key masking) */
	copyCode?: string;
}

export function TabbedCode({ tabs }: { tabs: CodeTab[] }) {
	const [active, setActive] = useState(0);

	// Seed cache with any pre-rendered html from props (server-rendered path).
	const [htmlCache, setHtmlCache] = useState<Record<number, string>>(() => {
		const seed: Record<number, string> = {};
		tabs.forEach((t, i) => {
			if (t.html) seed[i] = t.html;
		});
		return seed;
	});

	// For tabs without pre-rendered html, batch-highlight all of them on mount
	// so tab switches are instant cache reads instead of per-click server hits.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on tabs identity; htmlCache reads are a one-shot guard
	useEffect(() => {
		const missing = tabs
			.map((t, i) => ({ t, i }))
			.filter(({ t, i }) => !t.html && htmlCache[i] === undefined);
		if (missing.length === 0) return;

		let cancelled = false;
		Promise.all(missing.map(({ t }) => highlightCode(t.code, t.lang))).then(
			(results) => {
				if (cancelled) return;
				setHtmlCache((prev) => {
					const next = { ...prev };
					missing.forEach(({ i }, idx) => {
						next[i] = results[idx];
					});
					return next;
				});
			},
		);
		return () => {
			cancelled = true;
		};
		// Intentionally depend on tabs identity — re-highlights when tab set changes.
	}, [tabs]);

	const tab = tabs[active];
	const activeHtml = htmlCache[active];

	return (
		<div className="tabbed-code">
			<div className="tabbed-code-header">
				<div className="tabbed-code-tabs">
					{tabs.map((t, i) => (
						<button
							key={`${t.label}-${i}`}
							type="button"
							className={`tabbed-code-tab${i === active ? " active" : ""}`}
							onClick={() => setActive(i)}
						>
							{t.label}
						</button>
					))}
				</div>
			</div>
			<div className="tabbed-code-body">
				<CopyButton code={tab.copyCode ?? tab.code} />
				{activeHtml ? (
					// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki-highlighted code HTML
					<div dangerouslySetInnerHTML={{ __html: activeHtml }} />
				) : (
					<pre>
						<code>{tab.code}</code>
					</pre>
				)}
			</div>
		</div>
	);
}
