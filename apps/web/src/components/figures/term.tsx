"use client";

import { type ReactNode, useState } from "react";

export function Term({
	children,
	label,
	def,
}: {
	children: ReactNode;
	label: string;
	def: string;
}) {
	const [pinned, setPinned] = useState(false);

	return (
		<button
			type="button"
			className={pinned ? "fig-term pinned" : "fig-term"}
			onClick={() => setPinned(!pinned)}
		>
			{children}
			<span className="fig-term-def" role="tooltip">
				<b>{label}</b>
				{def}
			</span>
		</button>
	);
}
