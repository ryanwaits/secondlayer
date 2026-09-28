"use client";

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
