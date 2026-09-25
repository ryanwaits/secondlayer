"use client";

import {
	type Billing,
	formatUsd,
	refreshUsage,
	useAccountData,
} from "@/lib/account-data";
import { useAuth } from "@/lib/auth";
import {
	type Month,
	ROWS_ALLOWANCE,
	type UsageRow,
	accountCreationMonth,
	addMonths,
	allowanceFootLine,
	compareMonths,
	currentUtcMonth,
	formatRows,
	formatUnitQuantity,
	isSameMonth,
	monthLabel,
	monthName,
	monthParam,
	nextMonthLabel,
	spentUsdMicros,
	unitLabel,
} from "@/lib/usage";
import { useEffect, useState } from "react";

/**
 * The out-of-credits gate banner. Always reads the real current month's
 * usage from the store — not whatever month the table below is browsing —
 * so it stays put while the account is paused even if the person scrolls
 * the switcher into a past month. Doesn't fetch itself: `UsageSection`'s
 * default (offset-0) fetch loads the current month, so one page load makes
 * one usage call, not two.
 */
export function OutOfCreditsBanner({ billing }: { billing: Billing | null }) {
	const { usage } = useAccountData();
	const rows = usage[monthParam(currentUtcMonth())];

	if (!billing || rows === undefined) return null;
	const rowsDelivered = deliveredRowsIn(rows);
	const stopped =
		Number(billing.creditsUsdMicros) <= 0 && rowsDelivered >= ROWS_ALLOWANCE;
	if (!stopped) return null;

	return (
		<output className="use-stop">
			<div>
				<p className="use-stop-t">Reads are paused until you add credits</p>
				<p className="use-stop-l">
					You used this month's {formatRows(ROWS_ALLOWANCE)} free rows and your
					balance is $0. Hosted Index and Streams answer{" "}
					<code>402 insufficient_credits</code> until you top up; free rows
					return on {nextMonthLabel(currentUtcMonth())}.
				</p>
			</div>
		</output>
	);
}

function AllowanceMeter({
	deliveredRows,
	resetLabel,
}: {
	deliveredRows: number;
	resetLabel: string;
}) {
	const shown = Math.min(deliveredRows, ROWS_ALLOWANCE);
	const pct = Math.min(100, (deliveredRows / ROWS_ALLOWANCE) * 100);
	return (
		<div className="use-allow">
			<div className="use-allow-row">
				<span className="use-allow-k">Free rows this month</span>
				<span className="use-allow-v">
					{formatRows(shown)} <span>of {formatRows(ROWS_ALLOWANCE)}</span>
				</span>
			</div>
			<div
				className="use-bar"
				role="img"
				aria-label={`${Math.round(pct)}% of the monthly free rows used`}
			>
				<i style={{ width: `${pct.toFixed(1)}%` }} />
			</div>
			<div className="use-allow-foot">
				{allowanceFootLine(deliveredRows, resetLabel)}
			</div>
		</div>
	);
}

function UsageTable({
	usage,
	deliveredRows,
	monthWord,
}: {
	usage: UsageRow[];
	deliveredRows: number;
	monthWord: string;
}) {
	const body = usage.filter((u) => u.unit !== "topup");
	const topup = usage.find((u) => u.unit === "topup");
	const spent = spentUsdMicros(usage);

	return (
		<div className="use-table-wrap">
			<table className="use-table">
				<thead>
					<tr>
						<th>What</th>
						<th className="use-num">Quantity</th>
						<th className="use-num">Cost</th>
					</tr>
				</thead>
				<tbody>
					{body.map((u) => {
						const [label, subBase] = unitLabel(u.unit);
						const cost = Number(u.usdMicros);
						let sub = subBase;
						if (u.unit === "rows.delivered") {
							sub +=
								deliveredRows > ROWS_ALLOWANCE
									? " · first 10M free"
									: " · inside the free 10M";
						}
						return (
							<tr key={u.unit}>
								<td>
									{label}
									{sub ? <span className="use-sub">{sub}</span> : null}
								</td>
								<td className="use-num">
									{formatUnitQuantity(u.unit, u.quantity)}
								</td>
								<td className={`use-num${cost === 0 ? " use-free" : ""}`}>
									{cost === 0 ? "$0.00" : formatUsd(cost)}
								</td>
							</tr>
						);
					})}
					{topup ? (
						<tr>
							<td>
								Top-ups
								<span className="use-sub">
									Stripe · {topup.quantity} payment
									{topup.quantity === "1" ? "" : "s"}
								</span>
							</td>
							<td className="use-num" />
							<td className="use-num use-credit">
								+{formatUsd(-Number(topup.usdMicros))}
							</td>
						</tr>
					) : null}
				</tbody>
				<tfoot>
					<tr>
						<td>Spent in {monthWord}</td>
						<td />
						<td className="use-num">{formatUsd(spent)}</td>
					</tr>
				</tfoot>
			</table>
		</div>
	);
}

/** This month's rows.delivered from a usage list, or 0 if the unit hasn't
 *  billed anything yet. */
function deliveredRowsIn(usage: UsageRow[]): number {
	const rd = usage.find((u) => u.unit === "rows.delivered");
	return rd ? Number(rd.quantity) : 0;
}

/** "Usage" — month switcher, free-rows meter, and the usage table (or the
 *  empty-month box). Lives between `BalanceStats` and "Add credits" on
 *  /account/credits. */
export function UsageSection() {
	const { usage } = useAccountData();
	const { account } = useAuth();
	const [offset, setOffset] = useState(0);
	const [cur] = useState(() => currentUtcMonth());
	const month: Month = addMonths(cur, offset);
	const monthKey = monthParam(month);

	useEffect(() => {
		refreshUsage(monthKey);
	}, [monthKey]);

	const earliest = accountCreationMonth(account?.createdAt);
	const prevDisabled = earliest !== null && compareMonths(month, earliest) <= 0;
	const nextDisabled = isSameMonth(month, cur);
	const rows = usage[monthKey];

	return (
		<>
			<div className="use-head">
				<h2 className="acct-h2">Usage</h2>
				<div className="use-month">
					<button
						type="button"
						onClick={() => setOffset((o) => o - 1)}
						disabled={prevDisabled}
						aria-label="Previous month"
					>
						‹
					</button>
					<span>{monthLabel(month)}</span>
					<button
						type="button"
						onClick={() => setOffset((o) => o + 1)}
						disabled={nextDisabled}
						aria-label="Next month"
					>
						›
					</button>
				</div>
			</div>
			{rows === undefined ? null : rows.length === 0 ? (
				<div className="use-empty">
					No usage in {monthLabel(month)}. Your {formatRows(ROWS_ALLOWANCE)}{" "}
					free rows went unused.
				</div>
			) : (
				<>
					<AllowanceMeter
						deliveredRows={deliveredRowsIn(rows)}
						resetLabel={nextMonthLabel(month)}
					/>
					<UsageTable
						usage={rows}
						deliveredRows={deliveredRowsIn(rows)}
						monthWord={monthName(month)}
					/>
				</>
			)}
		</>
	);
}
