"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";

export type TreeNode = {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
	label: string;
};

export type TreeEdge = {
	id: string;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
};

/**
 * B8 TreeWalk — the log-time seek, performed. Choosing a key lights the
 * path from root to leaf one level at a time (instantly under
 * reduced-motion); the comparison counter is the argument.
 */
export function TreeWalk({
	nodes,
	edges,
	seeks,
	viewBox,
	ariaLabel,
}: {
	nodes: TreeNode[];
	edges: TreeEdge[];
	/** Each seek lights `path` (node and edge ids, root first). */
	seeks: { label: string; path: string[] }[];
	viewBox: string;
	ariaLabel: string;
}) {
	const [seekIdx, setSeekIdx] = useState<number | null>(null);
	const [litCount, setLitCount] = useState(0);
	const reduced = useReducedMotion();
	const timer = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(
		() => () => {
			if (timer.current) clearInterval(timer.current);
		},
		[],
	);

	const nodeIds = new Set(nodes.map((n) => n.id));
	const path = seekIdx === null ? [] : seeks[seekIdx].path;
	const lit = new Set(path.slice(0, litCount));
	const comparisons = path
		.slice(0, litCount)
		.filter((id) => nodeIds.has(id)).length;
	const done = litCount >= path.length && path.length > 0;

	const start = (i: number) => {
		if (timer.current) clearInterval(timer.current);
		setSeekIdx(i);
		const len = seeks[i].path.length;
		if (reduced) {
			setLitCount(len);
			return;
		}
		setLitCount(1);
		let n = 1;
		timer.current = setInterval(() => {
			n++;
			setLitCount(n);
			if (n >= len && timer.current) clearInterval(timer.current);
		}, 260);
	};

	return (
		<div>
			<div className="fig-controls">
				{seeks.map((s, i) => (
					<button
						key={s.label}
						type="button"
						className="fig-btn"
						aria-pressed={seekIdx === i}
						onClick={() => start(i)}
					>
						{s.label}
					</button>
				))}
			</div>
			<svg
				className="fig-tree-svg"
				viewBox={viewBox}
				role="img"
				aria-label={ariaLabel}
			>
				{edges.map((e) => (
					<line
						key={e.id}
						className={lit.has(e.id) ? "tedge lit" : "tedge"}
						x1={e.x1}
						y1={e.y1}
						x2={e.x2}
						y2={e.y2}
					/>
				))}
				{nodes.map((n) => (
					<g key={n.id} className={lit.has(n.id) ? "tnode lit" : "tnode"}>
						<rect x={n.x} y={n.y} width={n.w} height={n.h} rx={5} />
						<text x={n.x + n.w / 2} y={n.y + n.h / 2 + 4} textAnchor="middle">
							{n.label}
						</text>
					</g>
				))}
			</svg>
			<div className="fig-walk-out">
				{seekIdx === null ? (
					"Pick a key: the path lights one level at a time."
				) : (
					<>
						comparisons: <b>{comparisons}</b>
						{done && " · leaf reached, that is the whole seek"}
					</>
				)}
			</div>
		</div>
	);
}
