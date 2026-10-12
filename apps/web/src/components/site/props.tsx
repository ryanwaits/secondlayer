import type { ReactNode } from "react";

export interface PropItem {
	icon?: ReactNode;
	title: string;
	body: ReactNode;
}

/** Three short claims, ink rule on top of each. */
export function Props({ items }: { items: readonly PropItem[] }) {
	return (
		<div className="props">
			{items.map((item) => (
				<div key={item.title}>
					{item.icon}
					<h3>{item.title}</h3>
					<p>{item.body}</p>
				</div>
			))}
		</div>
	);
}
