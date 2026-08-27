"use client";

import type { ReactNode } from "react";
import { useState } from "react";

export interface HarnessOption {
	key: string;
	label: string;
	blurb: string;
}

/**
 * Step-1 harness switch. Panels are server-rendered (shiki) and passed in;
 * this only decides which one is visible, so nothing highlights on the client.
 */
export function HarnessPicker({
	options,
	panels,
}: {
	options: HarnessOption[];
	/** Same order as `options`. */
	panels: ReactNode[];
}) {
	const [active, setActive] = useState(0);
	const current = options[active];

	return (
		<>
			<div className="home-qs-pick" role="tablist" aria-label="Harness">
				{options.map((o, i) => (
					<button
						key={o.key}
						type="button"
						role="tab"
						aria-selected={i === active}
						onClick={() => setActive(i)}
					>
						{o.label}
					</button>
				))}
			</div>
			<p className="home-qs-blurb">{current.blurb}</p>
			{panels.map((panel, i) => (
				<div key={options[i].key} hidden={i !== active}>
					{panel}
				</div>
			))}
		</>
	);
}
