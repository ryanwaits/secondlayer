"use client";

import { LivePane } from "../live-pane";
import { everyMs, useInViewOnce, useStagedCycle } from "../use-demo";

const ROWS = [
	["SP2J6ZY4…X4QD", "412.08 sBTC", "1,204"],
	["SPN2K9X1…9TRF", "238.55 sBTC", "861"],
	["SP1Q4GH7…2MVE", "190.12 sBTC", "977"],
] as const;

// 3 result rows + settle mark
const MARKS = [...everyMs(900, 450, 3), 900 + 3 * 450 + 250];

/** Datasets demo: the DuckDB query "runs", rows land, footer settles. */
export function DuckdbGridPane() {
	const { ref, inView } = useInViewOnce<HTMLDivElement>();
	const { stage, cycle } = useStagedCycle(inView, MARKS, 12_000);
	const rowCount = Math.min(stage + 1, ROWS.length);
	const settled = stage >= MARKS.length - 1;

	return (
		<div ref={ref}>
			<LivePane
				dot="blue"
				title="duckdb · sbtc dataset"
				right={settled ? "0.4s" : "running…"}
			>
				<div className="home-grid" style={{ height: 128 }}>
					<div className="home-row home-row-h home-cols-d3">
						<span>sender</span>
						<span>total</span>
						<span>txs</span>
					</div>
					{ROWS.slice(0, rowCount).map((r) => (
						<div
							key={`${cycle}-${r[0]}`}
							className="home-row home-cols-d3 home-row-in"
						>
							{r.map((c) => (
								<span key={c}>{c}</span>
							))}
						</div>
					))}
				</div>
				<div className="home-gridfoot">
					<span>{settled ? "428,113 rows scanned · 14 parquet files" : " "}</span>
					<span>manifest latest.json · signed</span>
				</div>
			</LivePane>
		</div>
	);
}
