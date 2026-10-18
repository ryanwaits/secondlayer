"use client";

import { Sheet } from "@/components/mobile/sheet";
import { type Billing, PACKS_USD, formatUsd } from "@/lib/account-data";
import { monthProjection, unitLines } from "@/lib/billing-view";
import {
	type Burn,
	type DailySpend,
	type HostedStack,
	ROWS_ALLOWANCE,
	type UsageRow,
	balanceLevel,
	currentUtcMonth,
	daysInUtcMonth,
	deliveredRowsIn,
	formatRows,
	formatUnitQuantity,
	monthName,
	monthShortLabel,
	nextMonthLabel,
	runwayDays,
	unitLabel,
} from "@/lib/usage";
import { type ReactNode, useState } from "react";
import type { useCheckout } from "../credits-panel";

const MICROS = 1_000_000;
const DEFAULT_ALERT_PCT = 80;
/** Other units listed under Rows read. */
const MAX_UNIT_LINES = 3;

const monthDay = (date: Date) =>
	date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});

/**
 * The first UTC day on which spend, at a flat `ratePerDay`, reaches `cap`.
 * `spent` is what has been spent through the end of today. Null when nothing
 * is burning. The rate is the one the spend line projects with, so change both
 * together.
 */
export function capHitDate(
	spent: number,
	ratePerDay: number,
	cap: number,
	now: Date,
): Date | null {
	if (ratePerDay <= 0) return null;
	const days = spent >= cap ? 0 : Math.ceil((cap - spent) / ratePerDay);
	return new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days),
	);
}

const pct = (n: number) => `${Math.min(100, Math.max(0, n)).toFixed(1)}%`;

function Section({ title, aside }: { title: string; aside?: string }) {
	return (
		<div className="mac-sec">
			<b>{title}</b>
			{aside ? <span>{aside}</span> : null}
		</div>
	);
}

function Kv({ k, children }: { k: ReactNode; children: ReactNode }) {
	return (
		<div className="mac-kv">
			<span className="mac-k">{k}</span>
			<span className="mac-v">{children}</span>
		</div>
	);
}

function Pace({
	spent,
	capUsd,
	ratePerDay,
	projectedEnd,
	now,
}: {
	spent: number;
	capUsd: number | null;
	ratePerDay: number;
	projectedEnd: number;
	now: Date;
}) {
	const month = currentUtcMonth(now);
	if (capUsd != null && spent >= capUsd) {
		return (
			<p className="mac-pace">
				<span className="dash-dot alarm" />
				Paused: you reached your ${capUsd.toLocaleString("en-US")} cap.
				Everything resumes on {nextMonthLabel(month)}.
			</p>
		);
	}
	if (spent === 0) {
		return (
			<p className="mac-pace">
				<span className="dash-dot" />
				Inside the free tier
			</p>
		);
	}
	if (capUsd != null && projectedEnd >= capUsd) {
		const hit = capHitDate(spent, ratePerDay, capUsd, now);
		return (
			<p className="mac-pace">
				<span className="mac-ring" />
				{hit
					? `At this pace you hit the cap on ${monthDay(hit)}`
					: "At this pace you hit the cap this month"}
			</p>
		);
	}
	const last = daysInUtcMonth(month);
	return (
		<p className="mac-pace">
			<span className="dash-dot" />
			On pace for ${Math.round(projectedEnd)} by {monthShortLabel(month)} {last}
		</p>
	);
}

export interface UsageBodyProps {
	now: Date;
	billing: Billing | null;
	/** Whole-dollar spend cap, or null for none. */
	capUsd: number | null;
	/** Percent of the cap that sends the warning email. */
	alertPct?: number;
	usage: UsageRow[] | undefined;
	daily: DailySpend[] | undefined;
	burn: Burn | null;
	service: HostedStack | null;
	/** The way back from Stripe, above the month. */
	notice?: ReactNode;
	onTopUp: () => void;
}

/** Usage on a phone: spend against the cap, what was used, the balance. */
export function UsageBody({
	now,
	billing,
	capUsd,
	alertPct = DEFAULT_ALERT_PCT,
	usage,
	daily,
	burn,
	service,
	notice,
	onTopUp,
}: UsageBodyProps) {
	const month = currentUtcMonth(now);
	const spent = billing ? Number(billing.spentThisMonthUsdMicros) / MICROS : 0;
	const projection = daily ? monthProjection(daily, now) : null;
	const projectedEnd = projection?.projectedEnd ?? spent;
	const fill = capUsd ? (spent / capUsd) * 100 : 0;
	const paceEnd = capUsd ? Math.min(100, (projectedEnd / capUsd) * 100) : 0;

	const balance = billing ? Number(billing.creditsUsdMicros) : 0;
	const rateDay = burn ? Number(burn.rateDayUsdMicros) : 0;
	const runway = runwayDays(balance, rateDay);
	const level = balanceLevel({
		serviceState: service?.state ?? "none",
		balanceUsdMicros: balance,
		runwayDays: runway,
	});

	const others = usage
		? unitLines(usage)
				.filter((u) => u.unit !== "rows.delivered" && Number(u.quantity) > 0)
				.slice(0, MAX_UNIT_LINES)
		: [];

	return (
		<div className="mac">
			{notice}
			<Section
				title={monthName(month)}
				aside={`day ${now.getUTCDate()} of ${daysInUtcMonth(month)}`}
			/>
			<div className="mac-group mac-big">
				<div className="mac-n">
					{billing ? `$${spent.toFixed(2)}` : "…"}{" "}
					<small>{capUsd != null ? `of $${capUsd} cap` : "this month"}</small>
				</div>
				{capUsd != null ? (
					<>
						<div
							className="mac-meter"
							role="img"
							aria-label={`${Math.round(fill)}% of cap used`}
						>
							<span
								className="mac-pace-seg"
								style={{
									left: pct(fill),
									width: pct(Math.max(0, paceEnd - fill)),
								}}
							/>
							<i style={{ width: pct(fill) }} />
							<span className="mac-tick" style={{ left: `${alertPct}%` }} />
						</div>
						<div className="mac-axis" aria-hidden="true">
							<span>$0</span>
							<span style={{ left: `${alertPct}%` }}>{alertPct}%</span>
							<span>${capUsd}</span>
						</div>
					</>
				) : null}
				{billing && projection ? (
					<Pace
						spent={spent}
						capUsd={capUsd}
						ratePerDay={projection.ratePerDay}
						projectedEnd={projectedEnd}
						now={now}
					/>
				) : null}
			</div>
			{capUsd != null ? (
				<p className="m-sub mac-hint">
					Everything pauses past ${capUsd.toLocaleString("en-US")} in a month,
					webhooks included.
				</p>
			) : null}

			<Section title="What you used" />
			<div className="mac-group">
				<Kv k="Rows read">
					{usage ? formatRows(deliveredRowsIn(usage)) : "…"}{" "}
					<span className="mac-faint">· {formatRows(ROWS_ALLOWANCE)} free</span>
				</Kv>
				{others.map((u) => (
					<Kv key={u.unit} k={unitLabel(u.unit)[0]}>
						{formatUnitQuantity(u.unit, u.quantity)}
					</Kv>
				))}
			</div>

			<Section title="Balance" />
			<div className="mac-group">
				<Kv
					k={
						<>
							{level === "low" || level === "crit" ? (
								<span className="mac-ring" />
							) : null}
							{billing ? formatUsd(billing.creditsUsdMicros) : "…"}
						</>
					}
				>
					<span className="mac-sub">
						{Number.isFinite(runway)
							? `about ${Math.max(1, Math.round(runway))} days`
							: "the month"}
					</span>
				</Kv>
				<div className="mac-btns">
					<button type="button" className="mac-btn is-pri" onClick={onTopUp}>
						Top up
					</button>
				</div>
			</div>
		</div>
	);
}

type Checkout = ReturnType<typeof useCheckout>;

/** The top-up sheet's contents: amount, what it does to the balance, off to Stripe. */
export function TopupSheetBody({
	co,
	billing,
	burn,
}: {
	co: Checkout;
	billing: Billing | null;
	burn: Burn | null;
}) {
	const balance = billing ? Number(billing.creditsUsdMicros) / MICROS : 0;
	const after = balance + co.amount;
	const rateDay = burn ? Number(burn.rateDayUsdMicros) / MICROS : 0;
	const lasts = rateDay > 0 ? Math.max(1, Math.round(after / rateDay)) : null;
	return (
		<>
			<fieldset className="mac-amts">
				<legend className="m-sr">Amount</legend>
				{PACKS_USD.slice(0, 3).map((amount) => (
					<button
						key={amount}
						type="button"
						aria-pressed={co.amount === amount}
						onClick={() => co.choose(amount)}
					>
						${amount}
					</button>
				))}
			</fieldset>
			<div className="mac-group">
				<Kv k="Balance after">${after.toFixed(2)}</Kv>
				{lasts !== null ? (
					<Kv k="Lasts about">{lasts} days at this pace</Kv>
				) : null}
			</div>
			<p className="mac-fine">
				Paid with Stripe Checkout. Apple Pay and Google Pay work there. You come
				back here when it's done.
			</p>
			{co.error ? <p className="mac-error">{co.error}</p> : null}
			<button
				type="button"
				className="mac-btn is-pri is-wide"
				disabled={co.busy || !co.valid}
				onClick={co.checkout}
			>
				{co.busy ? "Opening Stripe…" : "Continue to Stripe"}
			</button>
		</>
	);
}

/** /account/credits on a phone: the usage body and its top-up sheet. */
export function UsageCompact({
	co,
	...props
}: Omit<UsageBodyProps, "onTopUp"> & { co: Checkout }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<UsageBody {...props} onTopUp={() => setOpen(true)} />
			<Sheet
				open={open}
				onClose={() => setOpen(false)}
				eyebrow={`Balance ${props.billing ? formatUsd(props.billing.creditsUsdMicros) : "…"}`}
				title="Top up"
			>
				<TopupSheetBody co={co} billing={props.billing} burn={props.burn} />
			</Sheet>
		</>
	);
}
