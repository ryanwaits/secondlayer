"use client";

import { LivePane, PaneChip } from "../live-pane";
import { everyMs, useInViewOnce, useStagedCycle } from "../use-demo";

const DELIVERIES = [
	{ ev: "1.20 sBTC · SP2J6…", ms: 84 },
	{ ev: "3.07 sBTC · SPN2K…", ms: 91 },
	{ ev: "1.51 sBTC · SP1Q4…", ms: 0, retry: true },
	{ ev: "2.84 sBTC · SP3K8…", ms: 77 },
	{ ev: "1.09 sBTC · SM2X9…", ms: 102 },
] as const;

// 5 delivery marks, retry-resolve mark, p50 settle mark
const ROW_MARKS = everyMs(500, 1100, 5);
const RETRY_RESOLVE = ROW_MARKS[2] + 1600;
const SETTLE = ROW_MARKS[4] + 900;
const MARKS = [...ROW_MARKS, RETRY_RESOLVE, SETTLE].sort((a, b) => a - b);
// after sorting: indexes of the retry-resolve + settle stages
const RETRY_STAGE = MARKS.indexOf(RETRY_RESOLVE);
const SETTLE_STAGE = MARKS.indexOf(SETTLE);

/** Subscriptions demo: deliveries land as latency bars; one retries and
 *  resolves; p50 settles at the end of the run. */
export function WebhookLatencyPane() {
	const { ref, inView } = useInViewOnce<HTMLDivElement>();
	const { stage, cycle } = useStagedCycle(inView, MARKS, 13_000);

	const rowsVisible = MARKS.slice(0, stage + 1).filter((m) =>
		(ROW_MARKS as number[]).includes(m),
	).length;
	const retryResolved = stage >= RETRY_STAGE;
	const settled = stage >= SETTLE_STAGE;

	return (
		<div ref={ref}>
			<LivePane
				dot="green"
				title="whale-alerts · active"
				right={settled ? "p50 88ms" : "p50 —"}
			>
				<div className="home-latrows" key={cycle}>
					{DELIVERIES.slice(0, rowsVisible).map((d) => {
						const isRetry = "retry" in d && d.retry;
						const resolved = isRetry && retryResolved;
						return (
							<div className="home-latrow home-row-in" key={d.ev}>
								<span className="ev">{d.ev}</span>
								<span className="track">
									<span
										className={`lat${isRetry && !resolved ? " warn" : ""}`}
										style={{
											width: isRetry
												? resolved
													? "46%"
													: "100%"
												: `${d.ms / 2}%`,
										}}
									/>
								</span>
								<span className="ms">
									{isRetry ? (
										resolved ? (
											"200 · retry 1"
										) : (
											<PaneChip state="wait">retrying…</PaneChip>
										)
									) : (
										`200 · ${d.ms}ms`
									)}
								</span>
							</div>
						);
					})}
				</div>
			</LivePane>
		</div>
	);
}
