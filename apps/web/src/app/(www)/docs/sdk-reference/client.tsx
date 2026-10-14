"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { resolveLegacy } from "./legacy";

/**
 * The filter above a surface's at-a-glance table. It hides rows whose method
 * path or summary lacks any typed word, and nothing else: the method entries
 * below stay put. The table is server-rendered; this only toggles `hidden`.
 */
export function GlanceFilter({
	count,
	children,
}: { count: number; children: ReactNode }) {
	const table = useRef<HTMLDivElement>(null);
	const [none, setNone] = useState(false);

	function apply(query: string) {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		let shown = 0;
		for (const row of table.current?.querySelectorAll<HTMLElement>(
			"tr[data-q]",
		) ?? []) {
			const text = row.dataset.q ?? "";
			const hit = words.every((w) => text.includes(w));
			row.hidden = !hit;
			if (hit) shown++;
		}
		setNone(shown === 0);
	}

	return (
		<>
			<label className="sdkr-filter">
				<span aria-hidden="true">⌕</span>
				<input
					type="search"
					placeholder={`Filter ${count} methods`}
					autoComplete="off"
					aria-label={`Filter ${count} methods`}
					onChange={(e) => apply(e.target.value)}
				/>
			</label>
			<div className="sdkr-glance-wrap" ref={table}>
				{children}
			</div>
			{none ? <p className="sdkr-none">No method matches.</p> : null}
		</>
	);
}

/** Old single-page anchors (`#x-streamsbatch`) follow the export to its new page. */
export function SdkHashRedirect({
	owners,
}: { owners: Record<string, string> }) {
	useEffect(() => {
		const go = () => {
			const href = resolveLegacy(owners, location.hash);
			if (href) location.replace(href);
		};
		go();
		window.addEventListener("hashchange", go);
		return () => window.removeEventListener("hashchange", go);
	}, [owners]);
	return null;
}
