"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { resolveLegacy } from "./legacy";

export function GlanceFilter({
	count,
	noun = "methods",
	children,
}: { count: number; noun?: string; children: ReactNode }) {
	const table = useRef<HTMLDivElement>(null);
	const [none, setNone] = useState(false);

	function apply(query: string) {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		let shown = 0;
		let label: HTMLElement | null = null;
		let inGroup = false;
		for (const row of table.current?.querySelectorAll<HTMLElement>(
			"tr[data-q], tr[data-group]",
		) ?? []) {
			if (row.dataset.group !== undefined) {
				if (label) label.hidden = !inGroup;
				label = row;
				inGroup = false;
				continue;
			}
			const text = row.dataset.q ?? "";
			const hit = words.every((w) => text.includes(w));
			row.hidden = !hit;
			if (hit) {
				shown++;
				inGroup = true;
			}
		}
		if (label) label.hidden = !inGroup;
		setNone(shown === 0);
	}

	return (
		<>
			<label className="sdkr-filter">
				<span aria-hidden="true">⌕</span>
				<input
					type="search"
					placeholder={`Filter ${count} ${noun}`}
					autoComplete="off"
					aria-label={`Filter ${count} ${noun}`}
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
