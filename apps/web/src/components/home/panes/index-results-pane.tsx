"use client";

import { LivePane } from "../live-pane";
import { everyMs, useInViewOnce, useStagedCycle } from "../use-demo";

const ROWS = [
	["SP2J6…X4QD", "SP3K8…9TRF", "1.20 sBTC", "7,978,231"],
	["SPN2K…1WPM", "SP1Q4…2MVE", "3.07 sBTC", "7,978,229"],
	["SP1Q4…2MVE", "SM2X9…H7RA", "1.51 sBTC", "7,978,226"],
	["SP3K8…9TRF", "SP2J6…X4QD", "2.84 sBTC", "7,978,224"],
] as const;

// 4 row marks + final "settle" mark for the count
const MARKS = [...everyMs(500, 380, 4), 500 + 4 * 380 + 250];

/** Index demo: a query returns a result set — rows fill in, count settles. */
export function IndexResultsPane() {
	const { ref, inView } = useInViewOnce<HTMLDivElement>();
	const { stage, cycle } = useStagedCycle(inView, MARKS, 11_000);
	const rowCount = Math.min(stage + 1, ROWS.length);
	const settled = stage >= MARKS.length - 1;

	return (
		<div ref={ref}>
			<LivePane
				dot="blue"
				title="ft-transfers · sbtc-token"
				right={settled ? "214,089 total · 41ms" : "querying…"}
			>
				<div className="home-grid" style={{ height: 160 }}>
					<div className="home-row home-row-h home-cols-r4">
						<span>sender</span>
						<span>recipient</span>
						<span>amount</span>
						<span>block</span>
					</div>
					{ROWS.slice(0, rowCount).map((r) => (
						<div
							key={`${cycle}-${r[3]}-${r[0]}`}
							className="home-row home-cols-r4 home-row-in"
						>
							{r.map((c) => (
								<span key={c}>{c}</span>
							))}
						</div>
					))}
				</div>
			</LivePane>
		</div>
	);
}
