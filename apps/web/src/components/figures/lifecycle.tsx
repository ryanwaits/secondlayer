"use client";

import { useState } from "react";

export type LifecycleNode = {
	id: string;
	label: string;
	x: number;
	y: number;
	w: number;
	h: number;
};

export type LifecycleEdge = {
	id: string;
	d: string;
	label?: string;
	labelX?: number;
	labelY?: number;
};

export type LifecycleStep = {
	node: string;
	edge?: string;
	caption: string;
};

/**
 * B4 Lifecycle — a state machine you can walk. "Step" advances along the
 * main path (the last step repeats); event buttons jump to their step,
 * and the next "step" follows the event's `resume` transition back. The
 * caption narrates every transition in words.
 */
export function Lifecycle({
	nodes,
	edges,
	viewBox,
	ariaLabel,
	mainPath,
	events,
	idleCaption,
}: {
	nodes: LifecycleNode[];
	edges: LifecycleEdge[];
	viewBox: string;
	ariaLabel: string;
	mainPath: LifecycleStep[];
	events?: { label: string; step: LifecycleStep; resume: LifecycleStep }[];
	/** Caption when stepping past the end of the main path. */
	idleCaption?: string;
}) {
	const [state, setState] = useState<{
		current: LifecycleStep | null;
		mainIdx: number;
		pending: LifecycleStep | null;
	}>({ current: null, mainIdx: -1, pending: null });

	const step = () => {
		if (state.pending) {
			setState({
				current: state.pending,
				mainIdx: state.mainIdx,
				pending: null,
			});
			return;
		}
		const next = state.mainIdx + 1;
		if (next < mainPath.length) {
			setState({ current: mainPath[next], mainIdx: next, pending: null });
		} else if (idleCaption && state.current) {
			setState({
				current: { node: state.current.node, caption: idleCaption },
				mainIdx: state.mainIdx,
				pending: null,
			});
		}
	};

	const current = state.current;

	return (
		<div>
			<div className="fig-controls">
				<button type="button" className="fig-btn" onClick={step}>
					step
				</button>
				{events?.map((ev) => (
					<button
						key={ev.label}
						type="button"
						className="fig-btn"
						onClick={() =>
							setState((s) => ({
								current: ev.step,
								mainIdx: s.mainIdx,
								pending: ev.resume,
							}))
						}
					>
						{ev.label}
					</button>
				))}
			</div>
			<svg
				className="fig-life-svg"
				viewBox={viewBox}
				role="img"
				aria-label={ariaLabel}
			>
				{edges.map((e) => (
					<g key={e.id}>
						<path
							className={current?.edge === e.id ? "ledge active" : "ledge"}
							d={e.d}
						/>
						{e.label && (
							<text
								className="elab"
								x={e.labelX}
								y={e.labelY}
								textAnchor="middle"
							>
								{e.label}
							</text>
						)}
					</g>
				))}
				{nodes.map((n) => (
					<g
						key={n.id}
						className={current?.node === n.id ? "lnode active" : "lnode"}
					>
						<rect x={n.x} y={n.y} width={n.w} height={n.h} rx={6} />
						<text x={n.x + n.w / 2} y={n.y + n.h / 2 + 4} textAnchor="middle">
							{n.label}
						</text>
					</g>
				))}
			</svg>
			<div className="fig-life-cap">
				{current?.caption ?? "Press step to start the machine."}
			</div>
		</div>
	);
}
