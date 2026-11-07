"use client";

import { HeatStripSkeleton } from "@/components/dashboard/charts/heat-strip";
import type { WebhooksResult } from "@/lib/dashboard-results";
import { useWake } from "@/lib/use-stack";
import { refreshList } from "@/lib/webhooks-store";

/** Ghost rows behind the asleep message: list-shaped, static, faded. */
const ASLEEP_GHOSTS = [
	{ name: 34, state: 62, sub: 28 },
	{ name: 26, state: 54, sub: 34 },
	{ name: 40, state: 48, sub: 22 },
];

const wakeStack = () => refreshList({ wake: true });

/** Every webhook is paused, so the stack stopped and stops billing. What lives
 *  on the stack (webhooks, subgraphs) can't be read, so this empty state
 *  stands in for it. Waking is the user's call: the next poll then shows it
 *  starting, and a wake that hasn't landed in 30 seconds says so. */
export function AsleepState({
	noun = "webhooks",
	wake = wakeStack,
}: {
	noun?: string;
	/** The wake request; the Lab swaps it to show a wake that never lands. */
	wake?: () => Promise<WebhooksResult<unknown>>;
} = {}) {
	const { waking, error, start } = useWake(wake);
	return (
		<section className="wh-asleep" aria-label="Hosted stack asleep">
			<div className="wh-asleep-ghosts" aria-hidden="true">
				{ASLEEP_GHOSTS.map((row) => (
					<div className="wl-row" key={row.name}>
						<div className="wl-main">
							<span className="ob-bar" style={{ width: `${row.name}%` }} />
							<span className="ob-bar" style={{ width: `${row.state}%` }} />
							<span className="ob-bar" style={{ width: `${row.sub}%` }} />
						</div>
						<HeatStripSkeleton />
					</div>
				))}
			</div>
			<div className="wh-asleep-c">
				<p className="wh-asleep-t">Your hosted stack is asleep</p>
				<p className="wh-asleep-l">
					Every webhook is paused, so the stack stopped and isn't billed. Wake
					it to see your {noun}
					{noun === "webhooks" ? " and resume one" : ""}.
				</p>
				<button
					type="button"
					className="acct-btn solid small"
					disabled={waking}
					onClick={start}
				>
					{waking ? "Waking…" : "Wake it"}
				</button>
				<p className="wh-asleep-f">
					{error ??
						(waking
							? `About 30 seconds. Your ${noun} show up here when it's up.`
							: "About 30 seconds. Billing starts again while it runs.")}
				</p>
			</div>
		</section>
	);
}
