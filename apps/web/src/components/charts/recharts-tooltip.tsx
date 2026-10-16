"use client";

import type { ReactNode } from "react";

// Adapted from Monocharts (MIT, github.com/Subhan-code/Monocharts)
// src/components/dither-charts/lib/recharts-tooltip.tsx — Tailwind classes and
// hardcoded colors replaced with this app's own CSS tokens (wh-* classes in
// globals.css), so it themes with the rest of the account area for free.
// Shared by every recharts-based chart on the webhooks and credits pages —
// one tooltip, not one per page.

interface TooltipPayloadItem {
	value?: number | string;
	name?: string;
	dataKey?: string | number;
	color?: string;
	fill?: string;
}

export interface ChartTooltipContentProps {
	active?: boolean;
	payload?: TooltipPayloadItem[];
	label?: string | number;
	formatter?: (value: number | string, name: string) => ReactNode;
	/** Passed through by recharts from `<Tooltip labelFormatter>`. */
	labelFormatter?: (label: string | number) => ReactNode;
}

export function ChartTooltip({
	active,
	payload,
	label,
	formatter,
	labelFormatter,
}: ChartTooltipContentProps) {
	if (!active || !payload || payload.length === 0) return null;
	const heading =
		label === undefined ? null : labelFormatter ? labelFormatter(label) : label;

	return (
		<div className="wh-chart-tip">
			{heading || heading === 0 ? (
				<div className="wh-chart-tip-label">{heading}</div>
			) : null}
			<div className="wh-chart-tip-rows">
				{payload.map((item) => {
					const color = item.color ?? item.fill ?? "var(--fig-role-a)";
					const name = item.name ?? String(item.dataKey ?? "");
					const value = formatter
						? formatter(item.value ?? "", name)
						: typeof item.value === "number"
							? item.value.toLocaleString("en-US")
							: item.value;
					return (
						<div className="wh-chart-tip-row" key={name}>
							<span className="wh-chart-tip-k">
								<span
									className="wh-chart-tip-dot"
									style={{ backgroundColor: color }}
								/>
								{name}
							</span>
							<span className="wh-chart-tip-v">{value}</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}
