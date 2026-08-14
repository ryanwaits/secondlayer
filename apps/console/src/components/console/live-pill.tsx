"use client";

import type { ReactNode } from "react";
import { useState } from "react";

export type LivePillState = "live" | "reindexing" | "error";

/**
 * Floating status pill (bottom-right). Compact `● Live` by default; click
 * expands a panel with state detail (stats / progress / error). One pill per
 * surface — fed system status on most pages, per-subgraph state on detail.
 */
export function LivePill({
	state,
	label,
	children,
}: {
	state: LivePillState;
	/** Compact label, e.g. "Live" / "Reindexing · 64%" / "Error". */
	label: string;
	/** Expanded panel body. */
	children?: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const dot =
		state === "live" ? "green" : state === "reindexing" ? "blue" : "red";

	return (
		<div className="live-pill-wrap">
			{open && children && (
				<>
					<button
						type="button"
						className="live-pill-backdrop"
						aria-label="Close status detail"
						onClick={() => setOpen(false)}
					/>
					<div className={`live-pill-panel s-${state}`}>{children}</div>
				</>
			)}
			<button
				type="button"
				className={`live-pill-trigger s-${state}`}
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
			>
				<span className={`lp-dot ${dot}`} />
				{label}
			</button>
		</div>
	);
}
