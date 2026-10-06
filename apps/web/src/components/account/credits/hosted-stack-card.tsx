"use client";

import { LazyMonoAreaLineChart } from "@/components/charts/lazy";
import { formatUsd, useAccountData } from "@/lib/account-data";
import {
	type HostedStack,
	MEMORY_FLOOR_GB,
	MEMORY_RATE_USD_PER_GB_HOUR,
	currentUtcMonth,
	formatMemoryChartYTick,
	latestMemoryHour,
	memoryChartXTickFormatter,
	memoryChartYTicks,
	memoryMinimumLabel,
	monthParam,
	runsOutDate,
	toMemoryChartPoints,
} from "@/lib/usage";

/**
 * "Hosted stack" — memory, last 24 hours. Hidden entirely when the
 * service has never run (`state === "none"`, Design step 5.4). "This
 * month" reads the current calendar month's `memory.gb_hour` total from
 * the store directly (kept fresh by the page's 60s poll of the current
 * month) — independent of whatever month the Usage switcher below is
 * browsing.
 */
export function HostedStackCard({ service }: { service: HostedStack }) {
	const { usage } = useAccountData();
	if (service.state === "none") return null;

	const running = service.state === "running";
	const now = new Date();
	const latest = latestMemoryHour(service.memory24h);
	const currentGb = latest ? (latest.observedGb ?? latest.billedGb) : 0;
	const billedGb = latest ? latest.billedGb : 0;

	let sub: string;
	if (!running) {
		const stoppedDate = service.lastChargedAt
			? runsOutDate(new Date(service.lastChargedAt), 0)
			: null;
		sub = stoppedDate
			? `Stopped ${stoppedDate} at $0 balance. Costs nothing while stopped.`
			: "Costs nothing while stopped.";
	} else if (currentGb < MEMORY_FLOOR_GB) {
		sub = `Using ${currentGb.toFixed(2)} GB. Billed at the ${MEMORY_FLOOR_GB} GB minimum while it runs.`;
	} else {
		sub = `Using ${currentGb.toFixed(2)} GB, above the ${MEMORY_FLOOR_GB} GB minimum, so you're billed for what it uses.`;
	}

	const currentMonthRows = usage[monthParam(currentUtcMonth(now))];
	const memoryRow = currentMonthRows?.find((u) => u.unit === "memory.gb_hour");
	const monthUsdMicros = memoryRow ? Number(memoryRow.usdMicros) : 0;

	const chartPoints = toMemoryChartPoints(service.memory24h, now);
	const yTicks = memoryChartYTicks(service.memory24h);

	return (
		<>
			<div className="h2row">
				<h2 className="acct-h2">Hosted stack</h2>
				<span className="aside">Runs your webhooks. One per account.</span>
			</div>
			<section className="use-card" aria-label="Hosted stack">
				<div className="use-svc-top">
					<div>
						<p className="use-svc-name">Memory, last 24 hours</p>
						<p className="use-svc-sub">{sub}</p>
					</div>
					<span className={`use-svc-state${running ? "" : " off"}`}>
						{running ? "Running" : "Stopped"}
					</span>
				</div>
				<LazyMonoAreaLineChart
					data={chartPoints}
					height={144}
					xDomain={[0, 24]}
					xTicks={[0, 12, 24]}
					xTickFormatter={memoryChartXTickFormatter}
					yTicks={yTicks}
					yTickFormatter={formatMemoryChartYTick}
					referenceLineY={{
						value: MEMORY_FLOOR_GB,
						label: memoryMinimumLabel(running, latest?.observedGb ?? null),
					}}
					showEndpointDot={service.memory24h.length > 0}
					valueName="Actual"
					extraSeries={[{ dataKey: "billedGb", name: "Billed" }]}
					tooltipFormatter={(v) => `${Number(v).toFixed(2)} GB`}
				/>
				<div className="use-svc-grid">
					<div>
						<span className="k">Billed memory</span>
						<span className="v">
							{running ? `${billedGb.toFixed(2)} GB` : "0 GB"}
						</span>
					</div>
					<div>
						<span className="k">Cost per hour</span>
						<span className="v">
							{running
								? `$${(billedGb * MEMORY_RATE_USD_PER_GB_HOUR).toFixed(4)}`
								: "$0.0000"}
						</span>
					</div>
					<div>
						<span className="k">This month</span>
						<span className="v">{formatUsd(monthUsdMicros)}</span>
					</div>
				</div>
				<p className="use-svc-note">
					Memory is sampled every minute and charged hourly at $
					{MEMORY_RATE_USD_PER_GB_HOUR} per GB-hour. A stopped service costs
					nothing.
				</p>
			</section>
		</>
	);
}
