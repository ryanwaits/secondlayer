"use client";

import type { ReactNode } from "react";

/**
 * A lazy-loaded chart's `next/dynamic` loading fallback — sized to that
 * chart's own default height so nothing jumps once the real thing (and its
 * `recharts` chunk) lands. Shared by every page that lazy-loads a chart
 * through `./lazy.tsx` (webhooks, credits) — one shimmer style, reused
 * rather than redefined per page.
 */
export function ChartSkeleton({ height = 120 }: { height?: number }) {
	return (
		<span
			className="wh-skel"
			aria-hidden="true"
			aria-label="Loading chart"
			style={{ display: "block", width: "100%", height, borderRadius: 8 }}
		/>
	);
}

/**
 * Holds a lazy chart's space at the height it will draw, from the first
 * frame: while the data loads, while its recharts chunk loads, and after.
 * `next/dynamic`'s loading skeleton can't see the chart's `height`, so
 * inside this box it fills the box instead of using its own fixed height.
 */
export function ChartBox({
	height,
	children,
}: { height: number; children?: ReactNode }) {
	return (
		<div className="dc-chart dc-chart-box" style={{ height }}>
			{children ?? <ChartSkeleton height={height} />}
		</div>
	);
}
