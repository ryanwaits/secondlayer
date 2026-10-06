"use client";

import { formatUsd, refreshUsage, useAccountData } from "@/lib/account-data";
import { useAuth } from "@/lib/auth";
import {
	type HostedStack,
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
	latestMemoryHour,
	monthLabel,
	monthName,
	monthParam,
	nextMonthLabel,
	rateLabel,
	spentUsdMicros,
	unitLabel,
} from "@/lib/usage";
import { Fragment, useCallback, useEffect, useState } from "react";

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
				<span className="use-allow-k">Free Index and Streams rows</span>
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
				{allowanceFootLine(deliveredRows, resetLabel)} Webhooks are billed per
				event and don't use free rows.
			</div>
		</div>
	);
}

/** The memory row's sub-line suffix: "· 0.50 GB billed", plus "(minimum)"
 *  when the hosted stack is currently billed at the 0.5 GB floor above
 *  its actual sampled RAM — matches the mock exactly. */
function memorySubNote(service: HostedStack | null): string {
	if (!service) return "";
	const latest = latestMemoryHour(service.memory24h);
	if (!latest) return "";
	const atFloor =
		latest.observedGb != null && latest.billedGb > latest.observedGb;
	return ` · ${latest.billedGb.toFixed(2)} GB billed${atFloor ? " (minimum)" : ""}`;
}

function UsageTable({
	usage,
	deliveredRows,
	monthWord,
	service,
}: {
	usage: UsageRow[];
	deliveredRows: number;
	monthWord: string;
	service: HostedStack | null;
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
						<th className="use-num">Rate</th>
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
									? ` · first ${formatRows(ROWS_ALLOWANCE)} free`
									: ` · inside the free ${formatRows(ROWS_ALLOWANCE)}`;
						}
						if (u.unit === "memory.gb_hour") {
							sub += memorySubNote(service);
						}
						const unpaid = Number(u.unpaidUsdMicros ?? "0");
						return (
							<Fragment key={u.unit}>
								<tr>
									<td>
										{label}
										{sub ? <span className="use-sub">{sub}</span> : null}
									</td>
									<td className="use-num">
										{formatUnitQuantity(u.unit, u.quantity)}
									</td>
									<td className="use-num use-free">
										{rateLabel(u.unit, u.quantity)}
									</td>
									<td className={`use-num${cost === 0 ? " use-free" : ""}`}>
										{cost === 0 ? "$0.00" : formatUsd(cost)}
									</td>
								</tr>
								{unpaid > 0 ? (
									<tr>
										<td>
											{label}
											<span className="use-sub">
												Charged while your balance was short
											</span>
										</td>
										<td className="use-num" />
										<td className="use-num use-free">
											{rateLabel(u.unit, u.quantity)}
										</td>
										<td className="use-num">
											{formatUsd(unpaid)}
											<span className="unpaid">unpaid</span>
										</td>
									</tr>
								) : null}
							</Fragment>
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
export type UsageStatus = "not_loaded" | "failed" | "ok";

/** The content under the month switcher: nothing (not loaded), a load-failed
 *  box with retry, the empty-month box, or the meter + table. Pure — no
 *  hooks, no fetch — so a render test can hit every status directly. */
export function UsageBody({
	status,
	month,
	rows,
	service,
	onRetry,
}: {
	status: UsageStatus;
	month: Month;
	rows: UsageRow[] | undefined;
	service: HostedStack | null;
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
				service={service}
			/>
		</>
	);
}

/**
 * Month-switcher state shared by the "<Month> so far" spend chart and the
 * Usage meter/table below it — one fetch per month change drives both.
 * `burn`/`service` (always "now") live in the account-data store directly
 * and aren't part of this hook.
 */
export function useUsageMonth() {
	const { usage, daily } = useAccountData();
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
	const status: UsageStatus =
		rows !== undefined
			? "ok"
			: failedMonth === monthKey
				? "failed"
				: "not_loaded";

	return {
		month,
		monthKey,
		rows,
		daily: daily[monthKey],
		status,
		prevDisabled,
		nextDisabled,
		goPrev: () => setOffset((o) => o - 1),
		goNext: () => setOffset((o) => o + 1),
		retry: () => load(monthKey),
	};
}

export type UsageMonthState = ReturnType<typeof useUsageMonth>;

/** "Usage" — month switcher, free-rows meter, and the usage table (or the
 *  empty-month box, or a load-failed box with retry). */
export function UsageSection({
	monthState,
	service,
}: {
	monthState: UsageMonthState;
	service: HostedStack | null;
}) {
	const {
		month,
		rows,
		status,
		prevDisabled,
		nextDisabled,
		goPrev,
		goNext,
		retry,
	} = monthState;
	return (
		<>
			<div className="use-head">
				<h2 className="acct-h2">Usage</h2>
				<div className="use-month">
					<button
						type="button"
						onClick={goPrev}
						disabled={prevDisabled}
						aria-label="Previous month"
					>
						‹
					</button>
					<span>{monthLabel(month)}</span>
					<button
						type="button"
						onClick={goNext}
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
				service={service}
				onRetry={retry}
			/>
		</>
	);
}
