"use client";

import { LazyMonoStackedBarChart } from "@/components/charts/lazy";
import { formatUsd } from "@/lib/account-data";
import {
	type DailySpend,
	type Month,
	ROWS_ALLOWANCE,
	type ServiceState,
	type UsageRow,
	buildDailyChart,
	currentUtcMonth,
	dailyChartNowReferenceDate,
	dailyChartXTickFormatter,
	dailyChartXTicks,
	dailyChartYAxis,
	daysInUtcMonth,
	formatDailyChartYTick,
	formatRows,
	fractionalDaysRemainingInMonth,
	isSameMonth,
	monthLabel,
	monthName,
	monthShortLabel,
	nextChargeLabel,
	nextMonthAtRateUsdMicros,
	projectedMonthEndUsdMicros,
	spentUsdMicros,
	toDailyChartRows,
} from "@/lib/usage";

const HATCH_PATTERN_ID = "credits-daily-spend-hatch";

/**
 * "<Month> so far" — the stacked daily-spend chart, its Spent/Projected/
 * Next-month header, and the legend. Past months (browsed via the Usage
 * switcher) drop the "so far" wording, the Updated/next-charge aside, and
 * the Projected/Next-month/Projected-legend pieces entirely — there's
 * nothing left to project once the month is over (Design step 5).
 */
export function SpendCard({
	month,
	rows,
	daily,
	rateDayUsdMicros,
	serviceState,
}: {
	month: Month;
	rows: UsageRow[] | undefined;
	daily: DailySpend[] | undefined;
	rateDayUsdMicros: number;
	serviceState: ServiceState;
}) {
	const now = new Date();
	const isCurrent = isSameMonth(month, currentUtcMonth(now));
	const spent = rows ? spentUsdMicros(rows) : 0;
	const days = buildDailyChart(daily ?? [], month, now, rateDayUsdMicros);
	const lastDayLabel = `${monthShortLabel(month)} ${daysInUtcMonth(month)}`;

	const chartRows = toDailyChartRows(days, rateDayUsdMicros);
	const yAxis = dailyChartYAxis(chartRows);
	const nowReferenceDate = isCurrent ? dailyChartNowReferenceDate(days) : null;

	return (
		<>
			<div className="h2row">
				<h2 className="acct-h2">
					{isCurrent ? `${monthName(month)} so far` : monthLabel(month)}
				</h2>
				{isCurrent ? (
					<span className="aside mono">
						{nextChargeLabel(now, serviceState)}
					</span>
				) : null}
			</div>
			<section className="use-card" aria-label="Spend by day">
				<div className="use-spend-head">
					<div>
						<span className="use-rk">Spent</span>
						<span className="v">{formatUsd(spent)}</span>
					</div>
					{isCurrent ? (
						<>
							<div>
								<span className="use-rk">Projected, {lastDayLabel}</span>
								<span className="v proj">
									{formatUsd(
										projectedMonthEndUsdMicros(
											spent,
											rateDayUsdMicros,
											fractionalDaysRemainingInMonth(now),
										),
									)}
								</span>
							</div>
							<div>
								<span className="use-rk">Next month at this rate</span>
								<span className="v proj">
									{formatUsd(nextMonthAtRateUsdMicros(rateDayUsdMicros, month))}
								</span>
							</div>
						</>
					) : null}
				</div>
				<LazyMonoStackedBarChart
					data={chartRows}
					height={170}
					xAxisDataKey="date"
					xAxisTicks={dailyChartXTicks(days, now.getUTCDate())}
					xAxisTickFormatter={dailyChartXTickFormatter(monthShortLabel(month))}
					yAxisTicks={yAxis.ticks}
					yAxisTickFormatter={(v) => formatDailyChartYTick(v, yAxis.decimals)}
					tooltipLabelFormatter={(date) =>
						dailyChartXTickFormatter(monthShortLabel(month))(String(date))
					}
					tooltipFormatter={(v) => formatUsd(Number(v) * 1_000_000)}
					referenceLineX={
						nowReferenceDate
							? { value: nowReferenceDate, label: "now" }
							: undefined
					}
					patternDefs={
						<pattern
							id={HATCH_PATTERN_ID}
							width={4}
							height={4}
							patternUnits="userSpaceOnUse"
							patternTransform="rotate(45)"
						>
							<rect width={4} height={4} fill="transparent" />
							<line
								x1={0}
								y1={0}
								x2={0}
								y2={4}
								stroke="var(--fig-bar)"
								strokeWidth={2}
							/>
						</pattern>
					}
					series={[
						{
							dataKey: "memUsd",
							name: "Hosted stack memory",
							color: "var(--fig-bar)",
						},
						{
							dataKey: "eventsUsd",
							name: "Webhook events",
							color: "var(--fig-role-a)",
						},
						{
							dataKey: "rowsUsd",
							name: `Rows past free ${formatRows(ROWS_ALLOWANCE)}`,
							color: "var(--fig-role-b)",
						},
						{
							dataKey: "projectedUsd",
							name: "Projected",
							color: `url(#${HATCH_PATTERN_ID})`,
						},
					]}
				/>
				<div className="use-legend">
					<span>
						<i style={{ background: "var(--fig-bar)" }} />
						Hosted stack memory
					</span>
					<span>
						<i style={{ background: "var(--fig-role-a)" }} />
						Webhook events
					</span>
					<span>
						<i style={{ background: "var(--fig-role-b)" }} />
						Rows past free {formatRows(ROWS_ALLOWANCE)}
					</span>
					{isCurrent ? (
						<span>
							<i className="proj" />
							Projected
						</span>
					) : null}
				</div>
			</section>
		</>
	);
}
