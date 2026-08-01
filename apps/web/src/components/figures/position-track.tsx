"use client";

import { useState } from "react";
import { mergeMarkers } from "./collide";

export type TrackMarker = {
	id: string;
	label: string;
	value?: string;
	role?: "a" | "b" | "muted";
	/** "dot" (default) renders a pin; "tick" a thin vertical bar. */
	kind?: "dot" | "tick";
	pos: number;
};

export type TrackState = { label: string; markers: TrackMarker[] };

/**
 * B1 PositionTrack — positions on one axis (heights, offsets), with
 * named states toggled by segmented buttons. Collision rule: markers
 * within 8% merge their flags into one combined label (joined " · ")
 * and collapse duplicate values; flags stagger on two tiers when
 * neighboring groups sit close.
 */
export function PositionTrack({ states }: { states: TrackState[] }) {
	const [idx, setIdx] = useState(0);
	const markers = states[idx].markers;
	const groups = mergeMarkers(markers);

	return (
		<div>
			{states.length > 1 && (
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
			)}
			<div className="fig-track">
				<div className="fig-rail" />
				{markers.map((m) => (
					<div key={m.id} className="fig-mk" style={{ left: `${m.pos}%` }}>
						<span
							className={[
								"fig-mk-pin",
								m.kind === "tick" ? "tick" : "",
								`role-${m.role ?? "muted"}`,
							]
								.filter(Boolean)
								.join(" ")}
						/>
					</div>
				))}
				{groups.map((g, gi) => {
					const label = g.members.map((m) => m.label).join(" · ");
					const role = g.members.length === 1 ? g.members[0].role : "muted";
					const prev = groups[gi - 1];
					const tier = prev && g.pos - prev.pos < 18 && gi % 2 === 1 ? 34 : 14;
					const values = [
						...new Set(g.members.map((m) => m.value).filter(Boolean)),
					];
					return (
						<span key={g.members[0].id}>
							<span
								className={`fig-mk-flag role-${role ?? "muted"}`}
								style={{ left: `${g.pos}%`, top: tier }}
							>
								{label}
							</span>
							{values.length > 0 && (
								<span
									className="fig-mk-val"
									style={{ left: `${g.pos}%`, top: 88 }}
								>
									{values[values.length - 1]}
								</span>
							)}
						</span>
					);
				})}
			</div>
		</div>
	);
}
