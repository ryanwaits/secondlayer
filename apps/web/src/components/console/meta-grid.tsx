import type { ReactNode } from "react";

interface MetaItem {
	label: string;
	value: ReactNode;
	sub?: string;
	mono?: boolean;
	valueColor?: string;
	tooltip?: string;
}

interface MetaGridProps {
	items: MetaItem[];
	columns?: string;
}

export function MetaGrid({ items, columns }: MetaGridProps) {
	return (
		<div
			className="sg-meta-grid"
			style={columns ? { gridTemplateColumns: columns } : undefined}
		>
			{items.map((item) => (
				<div key={item.label} className="sg-meta-card">
					<div className="sg-meta-label">
						{item.label}
						{item.tooltip && (
							<span className="info" title={item.tooltip}>
								<svg
									width="10"
									height="10"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.5"
									strokeLinecap="round"
									aria-label={item.tooltip}
									role="img"
								>
									<circle cx="8" cy="8" r="6" />
									<path d="M8 7v4" />
									<circle cx="8" cy="5" r="0.5" fill="currentColor" />
								</svg>
							</span>
						)}
					</div>
					<div
						className={`sg-meta-value${item.mono ? " mono" : ""}`}
						style={
							item.valueColor
								? { color: `var(--${item.valueColor})` }
								: undefined
						}
					>
						{item.value}
					</div>
					{item.sub && <div className="sg-meta-sub">{item.sub}</div>}
				</div>
			))}
		</div>
	);
}
