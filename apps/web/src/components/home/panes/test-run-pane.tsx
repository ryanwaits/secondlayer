"use client";

import { TESTING_RUN } from "@/lib/home-snippets";
import { useInViewOnce, useStagedCycle } from "../use-demo";

// Lines land in run order once the pane scrolls into view, then hold.
const MARKS = [400, 1600, 2100, 3100, 4300, 5600];

/** V3 right pane: the `sl subgraphs test` transcript, staged like a real run. */
export function TestRunPane() {
	const { ref, inView } = useInViewOnce<HTMLDivElement>();
	const { stage, cycle } = useStagedCycle(inView, MARKS, 14_000);
	const on = (i: number) => ({ opacity: stage >= i ? 1 : 0 });

	return (
		<div ref={ref} className="home-testrun" key={cycle}>
			<div>
				<span className="ps">$ </span>
				{TESTING_RUN.cmd}
			</div>
			<div className="ok" style={on(1)}>
				{TESTING_RUN.ok}
			</div>
			<div className="dim" style={on(1)}>
				{"  "}
				{TESTING_RUN.cassette}
			</div>
			<div style={on(2)}>
				<span className="ps">$ </span>
				{TESTING_RUN.offlineCmd}
			</div>
			<div className="ok" style={on(3)}>
				{TESTING_RUN.offlineOk}
			</div>
			<div className="note" style={on(4)}>
				{TESTING_RUN.guardNote}
			</div>
			<div className="err" style={on(5)}>
				{TESTING_RUN.guardErr}
			</div>
			<div className="dim" style={on(5)}>
				{"  "}
				{TESTING_RUN.guardDetail}
			</div>
		</div>
	);
}
