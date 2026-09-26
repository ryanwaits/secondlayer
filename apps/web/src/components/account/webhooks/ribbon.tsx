"use client";

import { ribbonCells } from "@/lib/webhook-graphs";
import type { DeliveryRow } from "@secondlayer/sdk";

/** The last 100 attempts, one cell each, oldest → newest. A plain CSS grid —
 *  100 cells never needs a chart library. */
export function AttemptRibbon({ rows }: { rows: DeliveryRow[] }) {
	const { cells, summary } = ribbonCells(rows);

	return (
		<div className="wh-chart">
			<div className="wh-chart-top">
				<span>Last 100 attempts</span>
				<span className="mono">{summary}</span>
			</div>
			<div
				className="wh-ribbon"
				role="img"
				aria-label="Outcome of the last 100 delivery attempts"
			>
				{cells.map((cell, i) => (
					<i
						// Cells are positional (oldest → newest); nothing else identifies one.
						// biome-ignore lint/suspicious/noArrayIndexKey: positional, not an identity
						key={i}
						className={
							cell.status === "ok"
								? ""
								: cell.status === "rate_limited"
									? "r"
									: "f"
						}
						title={cell.label}
					/>
				))}
			</div>
			<div className="wh-chart-ends">
				<span>oldest</span>
				<span>newest</span>
			</div>
		</div>
	);
}
