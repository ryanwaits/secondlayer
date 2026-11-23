"use client";

import { useState } from "react";

export type Layer = {
	label: string;
	sub?: string;
	kind?: "default" | "data" | "api";
	note: string;
};

export function LayerStack({ layers }: { layers: Layer[] }) {
	const [active, setActive] = useState<number | null>(null);

	return (
		<div>
			<div className="fig-stack">
				{layers.map((layer, i) => (
					<button
						key={layer.label}
						type="button"
						className={[
							"fig-layer",
							layer.kind && layer.kind !== "default" ? layer.kind : "",
							active === i ? "on" : "",
						]
							.filter(Boolean)
							.join(" ")}
						onMouseEnter={() => setActive(i)}
						onFocus={() => setActive(i)}
						onClick={() => setActive(i)}
					>
						{layer.label}
						{layer.sub && <span className="lsub">{layer.sub}</span>}
					</button>
				))}
			</div>
			<div className="fig-stack-note">
				{active === null ? "Hover or tap a layer." : layers[active].note}
			</div>
		</div>
	);
}
