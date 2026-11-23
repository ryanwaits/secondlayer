"use client";

import { useHoverPin } from "./use-hover-pin";

export type CrossSegment = string | { pair: string; text: string };

export function CrossHighlight({
	chips,
	segments,
}: {
	chips: { pair: string; kicker: string; label: string }[];
	segments: CrossSegment[];
}) {
	const { active, bind } = useHoverPin();

	return (
		<div className="fig-xhl">
			<div>
				{chips.map((chip) => (
					<button
						key={chip.pair}
						type="button"
						className={active === chip.pair ? "fig-xchip hot" : "fig-xchip"}
						{...bind(chip.pair)}
					>
						<span className="xk">{chip.kicker}</span>
						{chip.label}
					</button>
				))}
			</div>
			<pre>
				{segments.map((seg, i) =>
					typeof seg === "string" ? (
						// biome-ignore lint/suspicious/noArrayIndexKey: static segment list
						<span key={i}>{seg}</span>
					) : (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: static segment list
							key={i}
							className={active === seg.pair ? "fig-xval hot" : "fig-xval"}
							// biome-ignore lint/a11y/noNoninteractiveTabindex: focus lights the counterpart chip
							tabIndex={0}
							{...bind(seg.pair)}
						>
							{seg.text}
						</span>
					),
				)}
			</pre>
		</div>
	);
}
