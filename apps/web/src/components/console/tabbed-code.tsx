"use client";

import { highlightCode } from "@/components/command-palette/actions";
import { CopyButton } from "@/components/copy-button";
import { useEffect, useState } from "react";

export interface CodeTab {
	label: string;
	lang: string;
	/** Code displayed in the block (may be masked) */
	code: string;
	/** If set, CopyButton copies this instead of displayed code (for API key masking) */
	copyCode?: string;
}

export function TabbedCode({ tabs }: { tabs: CodeTab[] }) {
	const [active, setActive] = useState(0);
	const [htmlCache, setHtmlCache] = useState<Record<number, string>>({});

	const tab = tabs[active];

	useEffect(() => {
		if (htmlCache[active]) return;
		let cancelled = false;
		highlightCode(tab.code, tab.lang).then((result) => {
			if (!cancelled) {
				setHtmlCache((prev) => ({ ...prev, [active]: result }));
			}
		});
		return () => {
			cancelled = true;
		};
	}, [active, tab.code, tab.lang, htmlCache]);

	return (
		<div className="tabbed-code">
			<div className="tabbed-code-header">
				<div className="tabbed-code-tabs">
					{tabs.map((t, i) => (
						<button
							key={i}
							className={`tabbed-code-tab${i === active ? " active" : ""}`}
							onClick={() => setActive(i)}
						>
							{t.label}
						</button>
					))}
				</div>
				<CopyButton code={tab.copyCode ?? tab.code} />
			</div>
			<div className="tabbed-code-body">
				{htmlCache[active] ? (
					<div dangerouslySetInnerHTML={{ __html: htmlCache[active] }} />
				) : (
					<pre>
						<code>{tab.code}</code>
					</pre>
				)}
			</div>
		</div>
	);
}
