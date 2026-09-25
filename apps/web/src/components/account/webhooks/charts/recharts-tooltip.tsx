"use client";

import type { ReactNode } from "react";

// Adapted from Monocharts (MIT, github.com/Subhan-code/Monocharts)
// src/components/dither-charts/lib/recharts-tooltip.tsx — Tailwind classes and
// hardcoded colors replaced with this app's own CSS tokens (wh-* classes in
// globals.css), so it themes with the rest of the account area for free.

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
	label?: string;
	formatter?: (value: number | string, name: string) => ReactNode;
}

export function WebhookChartTooltip({
	active,
	payload,
	label,
	formatter,
}: ChartTooltipContentProps) {
	if (!active || !payload || payload.length === 0) return null;

	return (
		<div className="wh-chart-tip">
			{label ? <div className="wh-chart-tip-label">{label}</div> : null}
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
