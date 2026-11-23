import type { CSSProperties } from "react";

export type LegendSwatch = "line" | "square" | "ring" | "band" | "dashed";

export interface LegendItem {
	swatch: LegendSwatch;
	label: string;
	color?: string;
}

export function Legend({ items }: { items: readonly LegendItem[] }) {
	return (
		<div className="dc-legend">
			{items.map((item) => (
				<span key={item.label}>
					<i
						className={`dc-sw dc-sw-${item.swatch}`}
						style={
							item.color ? ({ "--sw": item.color } as CSSProperties) : undefined
						}
					/>
					{item.label}
				</span>
			))}
		</div>
	);
}
