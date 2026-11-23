"use client";

import { type ReactNode, useEffect, useState } from "react";

export type Invariant = {
	id: string;
	n: number;
	title: string;
	body: ReactNode;
};

export function InvariantList({ items }: { items: Invariant[] }) {
	const [open, setOpen] = useState<Set<string>>(new Set());

	useEffect(() => {
		const hash = window.location.hash.slice(1);
		if (hash && items.some((i) => i.id === hash)) {
			setOpen((prev) => new Set(prev).add(hash));
			document.getElementById(hash)?.scrollIntoView({ block: "center" });
		}
	}, [items]);

	const toggle = (id: string) =>
		setOpen((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	return (
		<div className="fig-invs">
			{items.map((item) => {
				const isOpen = open.has(item.id);
				return (
					<div
						key={item.id}
						className="fig-inv"
						data-open={isOpen}
						id={item.id}
					>
						<button
							type="button"
							className="fig-inv-head"
							aria-expanded={isOpen}
							onClick={() => toggle(item.id)}
						>
							<span className="fig-inv-no">#{item.n}</span>
							<span className="fig-inv-title">{item.title}</span>
							<span className="fig-inv-hint">+</span>
						</button>
						<div className="fig-inv-body">{item.body}</div>
					</div>
				);
			})}
		</div>
	);
}
