"use client";

import { type ReactNode, useState } from "react";

/**
 * A9 Term — hover-defined vocabulary for coined terms (receipt, bookmark,
 * sink). Dotted underline signals "defined here"; hover on pointer
 * devices, tap or focus elsewhere (tap pins, tap again unpins). Keep one
 * glossary per post so definitions are identical at every mention.
 */
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
