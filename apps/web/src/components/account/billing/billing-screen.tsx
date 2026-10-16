"use client";

import { ChartBox } from "@/components/charts/chart-skeleton";
import {
	LazyMonoStackedBarChart,
	LazySpendChart,
	preloadMonoStackedBarChart,
	preloadSpendChart,
} from "@/components/charts/lazy";
import { Legend } from "@/components/dashboard/charts/legend";
import { Meter } from "@/components/dashboard/charts/meter";
import { ActionableInsights } from "@/components/dashboard/insight/insight-actions";
import { StatusSentence } from "@/components/dashboard/shell/status-sentence";
import {
	type Billing,
	type TopupReturn,
	formatUsd,
	refreshBilling,
	refreshCaps,
	refreshCredits,
	refreshUsage,
	updateCap,
	useAccountData,
} from "@/lib/account-data";
import { daysLeft, daysLeftLabel } from "@/lib/account-health";
import {
	capDollars,
	capMeter,
	costByDay,
	dollars,
	freeRowsUsedUpOn,
	isSentinelUnit,
	monthProjection,
} from "@/lib/billing-view";
import { formatUsdTick, niceMax } from "@/lib/dashboard-charts";
import type { Insight } from "@/lib/insights";
import { forAccountRules, useInsights } from "@/lib/insights-store";
import type { CreditAdded } from "@/lib/types";
import {
	type Burn,
	type DailySpend,
	type HostedStack,
	ROWS_ALLOWANCE,
	type ServiceState,
	type UsageRow,
	balanceLevel,
	currentUtcMonth,
	deliveredRowsIn,
	formatRows,
	monthLabel,
	monthParam,
	monthShortLabel,
	nextMonthLabel,
	runwayDays,
} from "@/lib/usage";
import { poll } from "@/lib/webhooks-store";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	CheckoutAction,
	CreditAmounts,
	ReturnNotice,
	useCheckout,
	useTopupReturn,
} from "../credits-panel";
import { ByUnitTable } from "./by-unit-table";
import { CreditsAddedTable } from "./credits-added";
import { EmailAlerts } from "./email-alerts";
import { RatesTable } from "./rates-table";
import { SpendCapControl } from "./spend-cap-control";

const MICROS = 1_000_000;

/** The account-level rules about money; the rest belong to Overview and Rows. */
const BILLING_RULES = ["cap_pace", "credits_runway"];

/** Cost series colors, in stack order: the hosted stack, rows, webhook events plus storage. */
const COST_SERIES = [
	{ dataKey: "stack", name: "Hosted stack", color: "var(--ch-a)" },
	{ dataKey: "rows", name: "Rows", color: "var(--ch-b)" },
	{ dataKey: "events", name: "Webhook events + storage", color: "var(--ch-c)" },
] as const;

const usdTip = (value: number | string) => dollars(Number(value));

/** The sentence under the balance: what it is, and what to do about it. */
function Status({
	billing,
	burn,
	service,
	capUsd,
	now,
}: {
	billing: Billing | null;
	burn: Burn | null;
	service: HostedStack | null;
	capUsd: number | null;
	now: Date;
}) {
	if (!billing) {
		return <StatusSentence tone="idle">Checking your balance.</StatusSentence>;
	}
	const resets = nextMonthLabel(currentUtcMonth(now));
	const spent = Number(billing.spentThisMonthUsdMicros) / MICROS;
	if (capUsd != null && spent >= capUsd) {
		return (
			<StatusSentence
				tone="alarm"
				sub={`Everything resumes on ${resets}, or when you raise the cap.`}
			>
				Paused: you reached your ${capUsd.toLocaleString("en-US")} cap.
			</StatusSentence>
		);
	}
	const balance = Number(billing.creditsUsdMicros);
	const runway = burn
		? runwayDays(balance, Number(burn.rateDayUsdMicros))
		: Number.POSITIVE_INFINITY;
	const serviceState: ServiceState = service?.state ?? "none";
	const level = balanceLevel({
		serviceState,
		balanceUsdMicros: balance,
		runwayDays: runway,
	});
	const left = daysLeftLabel(daysLeft(billing, burn));
	const tone = level === "ok" ? "ok" : level === "low" ? "hi" : "alarm";
	return (
		<StatusSentence tone={tone}>
			<span>
				{formatUsd(billing.creditsUsdMicros)} left
				{level === "stopped" ? (
					<span className="bl-pace"> · your hosted stack has stopped</span>
				) : left ? (
					<span className="bl-pace"> · {left} at this pace</span>
				) : null}
			</span>
		</StatusSentence>
	);
}

/** A month with nothing spent and no credits yet: the free 1M and when to add more. */
function isFreshAccount(billing: Billing | null): boolean {
	return (
		billing !== null &&
		Number(billing.spentThisMonthUsdMicros) === 0 &&
		Number(billing.creditsUsdMicros) === 0
	);
}

function FreshMonth({
	deliveredRows,
	now,
}: { deliveredRows: number; now: Date }) {
	const free = Math.min(deliveredRows, ROWS_ALLOWANCE);
	return (
		<div className="bl-two even">
			<section className="dash-panel bl-panel" aria-label="Free rows">
				<span className="dash-label">Free rows</span>
				<Meter
					used={free}
					total={ROWS_ALLOWANCE}
					label="Free rows used this month"
					left={`${formatRows(free)} of ${formatRows(ROWS_ALLOWANCE)} free rows`}
					right={`resets ${nextMonthLabel(currentUtcMonth(now))}`}
				/>
				<span className="bl-note">
					Block headers never count. Nothing is charged until you add credits.
				</span>
			</section>
			<section className="dash-panel bl-panel" aria-label="Credits">
				<span className="dash-label">Credits</span>
				<div className="dash-big">$0.00</div>
				<div className="acct-row-actions">
					<a href="#packs" className="acct-btn line small">
						Add credits
					</a>
				</div>
				<span className="bl-note">Only needed past the free 1M.</span>
			</section>
		</div>
	);
}

export interface BillingBodyProps {
	now: Date;
	billing: Billing | null;
	burn: Burn | null;
	service: HostedStack | null;
	/** This month's usage by unit, or undefined until it loads. */
	usage: UsageRow[] | undefined;
	daily: DailySpend[] | undefined;
	/** The spend cap in whole dollars, or null for none. */
	capUsd: number | null;
	onCapChange: (next: number | null) => void;
	credits: CreditAdded[] | null;
	/** Insights about the account's spend, ranked by the server. */
	insights?: readonly Insight[];
	/** Shown above the status sentence, such as the way back from Stripe. */
	notice?: ReactNode;
	/** Sections under the tables: adding credits and emails. */
	footer?: ReactNode;
}

/** Billing: the balance, this month's spend line, the cap, where it goes, and what was added. */
export function BillingBody({
	now,
	billing,
	burn,
	service,
	usage,
	daily,
	capUsd,
	onCapChange,
	credits,
	insights = [],
	notice,
	footer,
}: BillingBodyProps) {
	const month = currentUtcMonth(now);
	const projection = daily ? monthProjection(daily, now) : null;
	const spentTotal = billing
		? Number(billing.spentThisMonthUsdMicros) / MICROS
		: 0;
	const projectedTotal = projection
		? spentTotal +
			projection.ratePerDay *
				(projection.daysInMonth - projection.series.length)
		: spentTotal;
	const meter = capMeter({
		capUsd,
		spentUsd: spentTotal,
		projectedEndUsd: projectedTotal,
		deliveredRows: deliveredRowsIn(usage ?? []),
		usedUpOn: daily ? freeRowsUsedUpOn(daily, now) : null,
		now,
	});
	const sentinelUsd = (usage ?? [])
		.filter((u) => isSentinelUnit(u.unit))
		.reduce((sum, u) => sum + Number(u.usdMicros), 0);

	const fresh = isFreshAccount(billing);
	const days = daily ? costByDay(daily, now) : null;
	const costTop = days
		? niceMax(Math.max(...days.map((d) => d.stack + d.rows + d.events)) * 1.05)
		: 1;

	if (fresh) {
		return (
			<div className="bl-body">
				{notice}
				<StatusSentence
					tone="idle"
					sub="The first 1M rows each month are free. Add credits only when you pass them."
				>
					$0.00 spent this month.
				</StatusSentence>
				<FreshMonth deliveredRows={deliveredRowsIn(usage ?? [])} now={now} />
				<ByUnitTable
					usage={usage}
					monthName={monthLabel(month).split(" ")[0]}
				/>
				{footer}
			</div>
		);
	}

	return (
		<div className="bl-body">
			{notice}
			<div className="bl-top">
				<Status
					billing={billing}
					burn={burn}
					service={service}
					capUsd={capUsd}
					now={now}
				/>
				<a href="#packs" className="acct-btn solid small">
					Add credits
				</a>
			</div>

			<ActionableInsights insights={insights} />

			<div className="bl-two">
				<section className="dash-panel bl-panel" aria-label="Usage this month">
					<div className="dash-panel-h">
						<span className="dash-label">Usage this month</span>
						<Legend
							items={[
								{ swatch: "line", label: "Spent" },
								{ swatch: "dashed", label: "At this pace" },
							]}
						/>
					</div>
					<ChartBox height={150}>
						{projection ? (
							<LazySpendChart
								daily={projection.series}
								daysInMonth={projection.daysInMonth}
								monthLabel={monthShortLabel(month)}
							/>
						) : null}
					</ChartBox>
					{sentinelUsd > 0 ? (
						<span className="bl-note">
							Sentinel runs ({dollars(sentinelUsd / MICROS)}) are billed per run
							and aren't in this line.
						</span>
					) : null}
				</section>

				<section className="dash-panel bl-panel" aria-label="Spend cap">
					<span className="dash-label">Spend cap</span>
					<SpendCapControl capUsd={capUsd} onChange={onCapChange} />
					<p className="bl-cap-text">
						{capUsd == null
							? "No cap set."
							: `Capped at $${capUsd.toLocaleString("en-US")} a month.`}{" "}
						At a cap everything stops, webhooks included, until you add credits
						or raise it.
					</p>
					<Meter
						used={meter.used}
						total={meter.total}
						left={meter.left}
						right={meter.right}
						label={meter.label}
					/>
				</section>
			</div>

			<section className="dash-panel bl-panel" aria-label="Where it goes">
				<div className="dash-panel-h">
					<span className="dash-label">Where it goes · per day</span>
					<Legend
						items={COST_SERIES.map((s) => ({
							swatch: "square" as const,
							label: s.name,
							color: s.color,
						}))}
					/>
				</div>
				<ChartBox height={150}>
					{days ? (
						<LazyMonoStackedBarChart
							data={days}
							height={150}
							xAxisDataKey="day"
							xAxisTicks={[days[0]?.day ?? "", days.at(-1)?.day ?? ""]}
							xAxisTickFormatter={(v) => String(v)}
							yAxisTicks={[0, costTop / 2, costTop]}
							yAxisTickFormatter={formatUsdTick}
							tooltipFormatter={usdTip}
							series={COST_SERIES.map((s) => ({ ...s }))}
						/>
					) : null}
				</ChartBox>
			</section>

			<div className="bl-two even">
				<ByUnitTable
					usage={usage}
					monthName={monthLabel(month).split(" ")[0]}
				/>
				<CreditsAddedTable credits={credits} />
			</div>

			{footer}
		</div>
	);
}

/** /account/credits: balance, spend and cap, with the way back from Stripe. */
export function BillingScreen({ ret }: { ret: TopupReturn | null }) {
	const { billing, burn, service, usage, daily, caps, credits } =
		useAccountData();
	const { data: allInsights } = useInsights();
	const st = useTopupReturn(ret);
	const co = useCheckout();
	const [pendingCap, setPendingCap] = useState<number | null | undefined>();
	const now = new Date();
	const month = monthParam(currentUtcMonth(now));

	useEffect(() => {
		refreshBilling();
		refreshCaps();
		refreshCredits();
		preloadSpendChart();
		preloadMonoStackedBarChart();
	}, []);

	// A landed top-up is a new row in the credits list.
	const landed = st?.kind === "landed";
	useEffect(() => {
		if (landed) refreshCredits();
	}, [landed]);

	// Every 60s while the tab is visible, refresh the month's usage. This is
	// also how `burn` and `service` (always "now") stay live.
	useEffect(() => {
		return poll(async () => {
			await refreshUsage(month);
			return {};
		}, 60_000);
	}, [month]);

	const capUsd =
		pendingCap !== undefined
			? pendingCap
			: capDollars(caps?.monthlyCapCents ?? null);

	async function changeCap(next: number | null) {
		setPendingCap(next);
		const result = await updateCap(next == null ? null : next * 100);
		setPendingCap(undefined);
		if (!result) toast.error("Couldn't update your spend cap");
	}

	const stopped = service?.state === "stopped";
	return (
		<BillingBody
			now={now}
			billing={billing}
			burn={burn}
			service={service}
			usage={usage[month]}
			daily={daily[month]}
			capUsd={capUsd}
			onCapChange={changeCap}
			credits={credits}
			insights={forAccountRules(allInsights, BILLING_RULES)}
			notice={st ? <ReturnNotice st={st} billing={billing} /> : null}
			footer={
				<>
					<section className="dash-panel bl-panel" aria-label="Add credits">
						<span className="dash-label">Add credits</span>
						<CreditAmounts
							co={co}
							wide
							rateDayUsdMicros={burn ? Number(burn.rateDayUsdMicros) : 0}
							stopped={stopped}
						/>
						<CheckoutAction co={co} wide />
						<RatesTable />
					</section>
					<EmailAlerts />
				</>
			}
		/>
	);
}
