import type { ReactNode } from "react";

export interface FaqItem {
	q: string;
	a: ReactNode;
}

/** Native <details> accordion; the first item opens by default. */
export function Faq({ items }: { items: readonly FaqItem[] }) {
	return (
		<div className="faq">
			{items.map((item, i) => (
				<details key={item.q} open={i === 0}>
					<summary>{item.q}</summary>
					<div className="a">{item.a}</div>
				</details>
			))}
		</div>
	);
}
