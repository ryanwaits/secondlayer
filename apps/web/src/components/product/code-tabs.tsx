"use client";

import { type ReactNode, useState } from "react";

/**
 * IDE-style window with clickable file tabs. Tab contents are pre-rendered on
 * the server (each is a <CodeBlock>, i.e. real Shiki output) and passed in;
 * switching tabs just toggles which already-rendered pane is shown — no
 * re-highlight, no client fetch.
 */
export function CodeTabs({
	tabs,
}: {
	tabs: { label: string; content: ReactNode }[];
}) {
	const [active, setActive] = useState(0);
	return (
		<div className="pp-window pp-win-solo">
			<div className="pp-bar">
				<div className="pp-dots">
					<i />
					<i />
					<i />
				</div>
			</div>
			<div className="pp-tabrow" role="tablist">
				{tabs.map((tab, i) => (
					<button
						key={tab.label}
						type="button"
						role="tab"
						aria-selected={i === active}
						className={`pp-tab${i === active ? " on" : ""}`}
						onClick={() => setActive(i)}
					>
						{tab.label}
					</button>
				))}
			</div>
			<div className="pp-body">
				<div className="pp-editor">{tabs[active]?.content}</div>
			</div>
		</div>
	);
}
