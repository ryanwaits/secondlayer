"use client";

import type { ReactNode } from "react";

/**
 * Shared shell for the homepage demo panes: header strip (status dot,
 * title, right-aligned counter) over a fixed-height body. Heights are
 * reserved by each pane's body — nothing in a pane may reflow the page.
 */
export function LivePane({
	dot,
	title,
	right,
	children,
}: {
	dot: "green" | "blue" | "amber";
	title: ReactNode;
	right?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="home-pane">
			<div className="home-pane-head">
				<span
					className={`home-dot home-dot-${dot}${dot === "amber" || dot === "green" ? " pulse" : ""}`}
				/>
				<span className="home-pane-title">{title}</span>
				<span className="home-pane-right">{right ?? " "}</span>
			</div>
			{children}
		</div>
	);
}

/** Status chip used inside panes (ok = green, wait = amber, busy = muted). */
export function PaneChip({
	state,
	children,
}: {
	state: "ok" | "wait" | "busy";
	children: ReactNode;
}) {
	return <span className={`home-chip home-chip-${state}`}>{children}</span>;
}
