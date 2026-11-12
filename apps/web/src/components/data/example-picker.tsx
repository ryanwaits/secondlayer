"use client";

import { Children, type ReactNode, useId, useState } from "react";

/**
 * The chip row above the examples. Every pane arrives server-rendered and
 * stays in the HTML (crawlers read all of them); choosing a chip only decides
 * which one is not `hidden`. Nothing is stored and the URL does not change.
 */
export function ExamplePicker({
	labels,
	children,
}: {
	labels: readonly string[];
	/** One pane per label, in order. */
	children: ReactNode;
}) {
	const id = useId();
	const [active, setActive] = useState(0);
	const panes = Children.toArray(children);
	return (
		<>
			{/* biome-ignore lint/a11y/useSemanticElements: a fieldset draws a frame the chip row must not have */}
			<div className="picks" role="group" aria-label="Examples">
				{labels.map((label, i) => (
					<button
						key={label}
						type="button"
						className="pick"
						data-pick={i}
						aria-pressed={i === active}
						aria-controls={`${id}-${i}`}
						onClick={() => setActive(i)}
					>
						{label}
					</button>
				))}
			</div>
			{panes.map((pane, i) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: panes are positional, one per chip
					key={i}
					id={`${id}-${i}`}
					hidden={i !== active}
				>
					{pane}
				</div>
			))}
		</>
	);
}
