import type { CSSProperties } from "react";

export type LegendSwatch =
	/** 10x2 line, `--ch-a` unless `color` is given. */
	| "line"
	/** 6x6 square, `--alarm` unless `color` is given. */
	| "square"
	/** 6x6 hollow ring. */
	| "ring"
	/** 12x8 swatch with a `--line` outline: the "usual range" band. */
	| "band"
	/** Dashed line: a context series. */
	| "dashed";

export interface LegendItem {
	swatch: LegendSwatch;
	label: string;
	/** A CSS color (a token such as `var(--hi)`) overriding the swatch default. */
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
