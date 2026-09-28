"use client";

import { formatUsd } from "@/lib/account-data";
import {
	type DailySpend,
	type Month,
	ROWS_ALLOWANCE,
	type ServiceState,
	type UsageRow,
	buildDailyChart,
	currentUtcMonth,
	daysInUtcMonth,
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
} from "@/lib/usage";
import { DailySpendChart } from "./charts/daily-spend-chart";

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
				<DailySpendChart
					days={days}
					rateDayUsdMicros={rateDayUsdMicros}
					nowDay={now.getUTCDate()}
					showNowLine={isCurrent}
					monthShortLabel={monthShortLabel(month)}
				/>
				<div className="use-legend">
					<span>
						<i style={{ background: "var(--fig-bar)" }} />
						Delivery service memory
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
