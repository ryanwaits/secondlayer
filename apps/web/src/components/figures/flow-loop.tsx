"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * B2 FlowLoop — a request/response loop between two parties. The counter
 * row is the argument; the shuttle dot is atmosphere (CSS keyframes,
 * paused under reduced-motion, where the counter also stops ticking).
 */
export function FlowLoop({
	left,
	right,
	counter,
	extras,
}: {
	left: { kicker: string; body: string };
	right: { kicker: string; body: string };
	/** A live tally, e.g. { label: "polls", intervalMs: 2200 }. */
	counter?: { label: string; intervalMs?: number };
	/** Static readout entries after the counter ("blocks read client-side: 0"). */
	extras?: { label: string; value: string }[];
}) {
	const [n, setN] = useState(0);
	const reduced = useReducedMotion();

	useEffect(() => {
		if (!counter || reduced) return;
		const t = setInterval(() => setN((x) => x + 1), counter.intervalMs ?? 2200);
		return () => clearInterval(t);
	}, [counter, reduced]);

	return (
		<div>
			<div className="fig-flow">
				<div className="fig-flow-node">
					<div className="fig-flow-nl">{left.kicker}</div>
					{left.body}
				</div>
				<div className="fig-wire" aria-hidden="true">
					<div className="fig-wire-line" />
					<div className="fig-wire-dot" />
				</div>
				<div className="fig-flow-node">
					<div className="fig-flow-nl">{right.kicker}</div>
					{right.body}
				</div>
			</div>
			{(counter || extras) && (
				<div className="fig-readout" style={{ marginTop: 12 }}>
					{counter && (
						<>
							{counter.label}: <b>{n.toLocaleString("en-US")}</b>
						</>
					)}
					{extras?.map((e) => (
						<span key={e.label}>
							{" "}
							&nbsp;·&nbsp; {e.label}: <b>{e.value}</b>
						</span>
					))}
				</div>
			)}
		</div>
	);
}
