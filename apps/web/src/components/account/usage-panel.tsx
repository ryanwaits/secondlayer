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
	deliveredRowsIn,
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
import { useCallback, useEffect, useState } from "react";

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

/** "not_loaded": no fetch has resolved for this month yet. "failed": the
 *  fetch resolved to null (bad status or network error) — `account-data.ts`
 *  swallows the reason, so all we know is it didn't load. "ok" covers both
 *  the empty-month and has-rows cases below, which `UsageBody` tells apart
 *  by `rows`. Tracked per month so switching months while one is failed
 *  doesn't carry the error along. */
type UsageStatus = "not_loaded" | "failed" | "ok";

/** The content under the month switcher: nothing (not loaded), a load-failed
 *  box with retry, the empty-month box, or the meter + table. Pure — no
 *  hooks, no fetch — so a render test can hit every status directly. */
export function UsageBody({
	status,
	month,
	rows,
	onRetry,
}: {
	status: UsageStatus;
	month: Month;
	rows: UsageRow[] | undefined;
	onRetry: () => void;
}) {
	if (status === "not_loaded") return null;
	if (status === "failed") {
		return (
			<div className="use-error">
				<p>Couldn't load usage for {monthLabel(month)}.</p>
				<button type="button" className="acct-btn line small" onClick={onRetry}>
					Retry
				</button>
			</div>
		);
	}
	if (!rows || rows.length === 0) {
		return (
			<div className="use-empty">
				No usage in {monthLabel(month)}. Your {formatRows(ROWS_ALLOWANCE)} free
				rows went unused.
			</div>
		);
	}
	return (
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
	);
}

/** "Usage" — month switcher, free-rows meter, and the usage table (or the
 *  empty-month box, or a load-failed box with retry). Lives between
 *  `BalanceStats` and "Add credits" on /account/credits. */
export function UsageSection() {
	const { usage } = useAccountData();
	const { account } = useAuth();
	const [offset, setOffset] = useState(0);
	const [cur] = useState(() => currentUtcMonth());
	const month: Month = addMonths(cur, offset);
	const monthKey = monthParam(month);
	const [failedMonth, setFailedMonth] = useState<string | null>(null);

	const load = useCallback((key: string) => {
		refreshUsage(key).then((result) => {
			setFailedMonth((prev) => {
				if (result !== null) return prev === key ? null : prev;
				return key;
			});
		});
	}, []);

	useEffect(() => {
		load(monthKey);
	}, [monthKey, load]);

	const earliest = accountCreationMonth(account?.createdAt);
	const prevDisabled = earliest !== null && compareMonths(month, earliest) <= 0;
	const nextDisabled = isSameMonth(month, cur);
	const rows = usage[monthKey];
	// Stale rows from an earlier successful fetch still render — a failed
	// retry shouldn't blank out data that's already on screen.
	const status: UsageStatus =
		rows !== undefined
			? "ok"
			: failedMonth === monthKey
				? "failed"
				: "not_loaded";

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
			<UsageBody
				status={status}
				month={month}
				rows={rows}
				onRetry={() => load(monthKey)}
			/>
		</>
	);
}
