"use client";

import { useState } from "react";

export type BaMarker = {
	id: string;
	flag: string;
	tone: "a" | "b" | "alarm";
	kind?: "dot" | "tick";
	pos: number;
	value?: string;
	hidden?: boolean;
};

export type BaState = {
	label: string;
	markers: BaMarker[];
	zone?: { left: number; width: number; visible: boolean };
};

/**
 * B9 BeforeAfter — one geometry, two (or more) states. A segmented
 * toggle switches states; shared markers keep their identity (keyed by
 * id) so only the deltas move and the eye tracks WHAT changed.
 */
export function BeforeAfter({ states }: { states: BaState[] }) {
	const [idx, setIdx] = useState(0);
	const state = states[idx];
	const zone = state.zone;

	return (
		<div>
			<div className="fig-controls">
				{states.map((s, i) => (
					<button
						key={s.label}
						type="button"
						className="fig-btn"
						aria-pressed={i === idx}
						onClick={() => setIdx(i)}
					>
						{s.label}
					</button>
				))}
			</div>
			<div className="fig-ba-track">
				<div className="fig-rail" />
				{zone && (
					<div
						className="fig-ba-zone"
						style={{
							left: `${zone.left}%`,
							width: `${zone.width}%`,
							opacity: zone.visible ? 1 : 0,
						}}
					/>
				)}
				{state.markers.map((m) => (
					<div
						key={m.id}
						className="fig-ba-mk"
						style={{ left: `${m.pos}%`, opacity: m.hidden ? 0 : 1 }}
					>
						<span
							className={`fig-ba-flag ${m.tone === "alarm" ? "alarm" : `role-${m.tone}`}`}
						>
							{m.flag}
						</span>
						<span
							className={[
								"fig-ba-pin",
								m.kind === "tick" ? "tick" : "",
								m.tone === "alarm" ? "alarm" : `role-${m.tone}`,
							]
								.filter(Boolean)
								.join(" ")}
						/>
						{m.value && <span className="fig-ba-val">{m.value}</span>}
					</div>
				))}
			</div>
		</div>
	);
}
