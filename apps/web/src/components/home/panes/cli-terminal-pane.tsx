"use client";

import { useInViewOnce, useStagedCycle } from "../use-demo";

const CMD = "sl subgraphs deploy sbtc-flows.ts";
const OUTPUTS = [
	"✓ deployed sbtc-flows (public)",
	"read:  /v1/subgraphs/sbtc-flows/transfers",
	"share: secondlayer.tools/subgraphs/explore/sbtc-flows",
];

// typing (CSS steps) finishes ~1.5s in; outputs land strictly after
const TYPE_DONE = 1900;
const MARKS = [
	150, // start typing
	TYPE_DONE,
	TYPE_DONE + 480,
	TYPE_DONE + 960,
	TYPE_DONE + 1440, // trailing prompt
];

/** CLI demo: the command types to completion, then outputs land in order. */
export function CliTerminalPane() {
	const { ref, inView } = useInViewOnce<HTMLDivElement>();
	const { stage, cycle } = useStagedCycle(inView, MARKS, 13_000);
	const typingStarted = stage >= 0;
	const typed = stage >= 1;
	const outputsOn = Math.max(0, stage - 1); // 0..3 (3rd = trailing prompt)

	return (
		<div ref={ref} className="home-pane">
			<div className="home-term" key={cycle}>
				<div>
					<span className="ps">$ </span>
					{typingStarted && (
						<span
							className={`home-term-typed${typed ? " done" : ""}`}
							style={{ ["--chars" as string]: CMD.length }}
						>
							{CMD}
						</span>
					)}
					{!typed && <span className="home-caret" aria-hidden="true" />}
				</div>
				{OUTPUTS.map((line, i) => (
					<div
						key={line}
						className="out"
						style={{ opacity: outputsOn > i ? 1 : 0 }}
					>
						{line}
					</div>
				))}
				<div style={{ opacity: outputsOn > OUTPUTS.length - 1 ? 1 : 0 }}>
					<span className="ps">$ </span>
					<span className="home-caret" aria-hidden="true" />
				</div>
			</div>
		</div>
	);
}
