import type { ReactNode } from "react";

export interface MeterItem {
	label: string;
	value: string;
	body: ReactNode;
}

/** Price/allowance tiles. */
export function Meters({ items }: { items: readonly MeterItem[] }) {
	return (
		<div className="meters">
			{items.map((item) => (
				<div className="meter" key={item.label}>
					<span className="k">{item.label}</span>
					<span className="v">{item.value}</span>
					<p>{item.body}</p>
				</div>
			))}
		</div>
	);
}
