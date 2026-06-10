"use client";

import { LivePane } from "../live-pane";
import { useInViewOnce, useStagedCycle } from "../use-demo";

const SCRIPT = [
	{
		block: "#7,978,232",
		events: "8 events",
		at: "+0.0s",
		cursor: "7,978,232:8",
	},
	{
		block: "#7,978,233",
		events: "11 events",
		at: "+2.4s",
		cursor: "7,978,233:11",
	},
	{
		block: "#7,978,234",
		events: "6 events",
		at: "+4.9s",
		cursor: "7,978,234:6",
	},
	{
		block: "#7,978,235",
		events: "12 events",
		at: "+7.3s",
		cursor: "7,978,235:12",
	},
] as const;

const MARKS = [600, 2100, 3600, 5100];

/** Streams demo: four blocks land as plain rows, newest on top; replays. */
export function StreamsBlocksPane() {
	const { ref, inView } = useInViewOnce<HTMLDivElement>();
	const { stage, cycle } = useStagedCycle(inView, MARKS, 12_000);
	const visible = SCRIPT.slice(0, stage + 1);

	return (
		<div ref={ref}>
			<LivePane
				dot="green"
				title={
					<>
						consuming · cursor{" "}
						{stage >= 0 ? SCRIPT[stage].cursor : "7,978,231:42"}
					</>
				}
				right="0 reorgs"
			>
				<div className="home-grid" style={{ height: 160 }}>
					<div className="home-row home-row-h home-cols-b3">
						<span>block</span>
						<span>events</span>
						<span>received</span>
					</div>
					{[...visible].reverse().map((r) => (
						<div
							key={`${cycle}-${r.block}`}
							className="home-row home-cols-b3 home-row-in"
						>
							<span>{r.block}</span>
							<span>{r.events}</span>
							<span>{r.at}</span>
						</div>
					))}
				</div>
			</LivePane>
		</div>
	);
}
