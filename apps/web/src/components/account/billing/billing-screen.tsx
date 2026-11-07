"use client";

import { ChartBox } from "@/components/charts/chart-skeleton";
import { LazySpendChart, preloadSpendChart } from "@/components/charts/lazy";
import { Legend } from "@/components/dashboard/charts/legend";
import { ActionableInsights } from "@/components/dashboard/insight/insight-actions";
import { Mark } from "@/components/dashboard/shell/mark";
import { StatusSentence } from "@/components/dashboard/shell/status-sentence";
import { useCompact } from "@/components/mobile/use-compact";
import { notify } from "@/components/toast/notify";
import {
	type Billing,
	type TopupReturn,
	ensureBilling,
	ensureCaps,
	ensureCredits,
	formatUsd,
	refreshCaps,
	refreshCredits,
	refreshUsage,
	updateCap,
	useAccountData,
} from "@/lib/account-data";
import { daysLeft, daysLeftLabel } from "@/lib/account-health";
import {
	capDollars,
	dollars,
	isSentinelUnit,
	monthProjection,
} from "@/lib/billing-view";
import type { Insight } from "@/lib/insights";
import { forAccountRules, useInsights } from "@/lib/insights-store";
import { useSave } from "@/lib/save-state";
import { stackStatus } from "@/lib/stack-status";
import type { CreditAdded } from "@/lib/types";
import {
	type BalanceLevel,
	type Burn,
	type DailySpend,
	type HostedStack,
	ROWS_ALLOWANCE,
	type ServiceState,
	type UsageRow,
	balanceLevelFor,
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
import { AccountCompactHeader } from "../compact-account";
import {
	AddCredits,
	ReturnNotice,
	useCheckout,
	useTopupReturn,
} from "../credits-panel";
import { ByUnitTable } from "./by-unit-table";
import { UsageCompact } from "./compact-usage";
import { CreditsAddedTable } from "./credits-added";
import { LimitsAndEmails } from "./limits-and-emails";

const MICROS = 1_000_000;

/** The account-level rules about money; the rest belong to Overview and Rows. */
const BILLING_RULES = ["cap_pace", "credits_runway"];

/** The balance as one sentence, with its days, rate and month-end pace under it. */
function Status({
	billing,
	burn,
	service,
	capUsd,
	now,
	projectedEnd,
}: {
	billing: Billing | null;
	burn: Burn | null;
	service: HostedStack | null;
	capUsd: number | null;
	now: Date;
	/** Where the month ends up at the last 7 days' pace, or null until the daily spend loads. */
	projectedEnd: number | null;
}) {
	if (!billing) {
		// The sub-line is reserved (a no-break space) so the loaded sentence
		// doesn't push the page down.
		return (
			<StatusSentence sub={"\u00a0"}>Checking your balance.</StatusSentence>
		);
	}
	const month = currentUtcMonth(now);
	const spent = Number(billing.spentThisMonthUsdMicros) / MICROS;
	if (capUsd != null && spent >= capUsd) {
		return (
			<StatusSentence
				sub={`Everything resumes on ${nextMonthLabel(month)}, or when you raise the cap.`}
			>
				Paused: you reached your ${capUsd.toLocaleString("en-US")} cap.
			</StatusSentence>
		);
	}
	const level = balanceLevelFor(billing, burn, service);
	if (level === "stopped") {
		return (
			<StatusSentence sub="Webhooks and subgraphs pick up where they left off once you add credits.">
				<Mark tone="fail">{formatUsd(billing.creditsUsdMicros)}</Mark> left.
				Your hosted stack has stopped.
			</StatusSentence>
		);
	}
	const left = daysLeftLabel(daysLeft(billing, burn));
	const spentIn = `${dollars(spent)} spent in ${monthLabel(month).split(" ")[0]}`;
	const pace =
		projectedEnd === null ? "" : `, on pace for ${dollars(projectedEnd)}`;
	return (
		<StatusSentence
			sub={
				<>
					{left && burn ? (
						<>
							{left.charAt(0).toUpperCase() + left.slice(1)} at{" "}
							<code className="bl-num">{formatUsd(burn.rateDayUsdMicros)}</code>{" "}
							a day.{" "}
						</>
					) : null}
					{spentIn}
					{pace}.
				</>
			}
		>
			{level === "low" || level === "crit" ? (
				<Mark tone="att">{formatUsd(billing.creditsUsdMicros)}</Mark>
			) : (
				formatUsd(billing.creditsUsdMicros)
			)}{" "}
			left.
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

/** The Add credits band: the page's anchor for "add credits" links. Yellow
 *  only while the balance is running short; a stopped stack is neutral. */
function CreditsBand({
	urgent,
	children,
}: { urgent: boolean; children: ReactNode }) {
	return (
		<section
			className={urgent ? "bl-band urgent" : "bl-band"}
			aria-label="Add credits"
			id="packs"
		>
			{children}
		</section>
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
	/** Set when the credits list failed to load: the table shows Retry. */
	onRetryCredits?: () => void;
	/** Insights about the account's spend, ranked by the server. */
	insights?: readonly Insight[];
	/** Shown above the status sentence, such as the way back from Stripe. */
	notice?: ReactNode;
	/** The Add credits band's cells: amount, runway line, checkout button. */
	addCredits: ReactNode;
	/** The limit and email settings, under the credits added. */
	settings: ReactNode;
}

/** Billing: the balance, this month's spend line, adding credits, where it goes, and what was added. */
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
	onRetryCredits,
	insights = [],
	notice,
	addCredits,
	settings,
}: BillingBodyProps) {
	const month = currentUtcMonth(now);
	const monthName = monthLabel(month).split(" ")[0] ?? "";
	const projection = daily ? monthProjection(daily, now) : null;
	const spentTotal = billing
		? Number(billing.spentThisMonthUsdMicros) / MICROS
		: 0;
	const sentinelUsd = (usage ?? [])
		.filter((u) => isSentinelUnit(u.unit))
		.reduce((sum, u) => sum + Number(u.usdMicros), 0);

	const fresh = isFreshAccount(billing);
	if (fresh) {
		const free = Math.min(deliveredRowsIn(usage ?? []), ROWS_ALLOWANCE);
		return (
			<div className="bl-body">
				{notice}
				<StatusSentence
					sub={`Nothing spent yet. Add credits only when you pass the free rows or start a hosted stack. ${formatRows(free)} of your free ${formatRows(ROWS_ALLOWANCE)} rows used. Resets ${nextMonthLabel(month)}.`}
				>
					1M rows free this month.
				</StatusSentence>
				<CreditsBand urgent={false}>{addCredits}</CreditsBand>
				<div className="bl-cols">
					<ByUnitTable usage={usage} monthName={monthName} />
					<div className="bl-col">
						<CreditsAddedTable credits={credits} onRetry={onRetryCredits} />
						{settings}
					</div>
				</div>
			</div>
		);
	}

	const level = balanceLevelFor(billing, burn, service);
	const urgent = level === "low" || level === "crit";
	return (
		<div className="bl-body">
			{notice}
			<Status
				billing={billing}
				burn={burn}
				service={service}
				capUsd={capUsd}
				now={now}
				projectedEnd={projection?.projectedEnd ?? null}
			/>

			<ActionableInsights insights={insights} />

			<section className="dash-panel bl-panel" aria-label="Spent this month">
				<div className="dash-panel-h">
					<span className="dash-label">Spent this month</span>
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
						Sentinel usage ({dollars(sentinelUsd / MICROS)}) is billed per check
						and event and isn't in this line.
					</span>
				) : null}
			</section>

			<CreditsBand urgent={urgent}>{addCredits}</CreditsBand>

			<div className="bl-cols">
				<ByUnitTable usage={usage} monthName={monthName} />
				<div className="bl-col">
					<CreditsAddedTable credits={credits} onRetry={onRetryCredits} />
					{settings}
				</div>
			</div>
		</div>
	);
}

/** /account/credits: balance, spend and limits, with the way back from Stripe. */
export function BillingScreen({ ret }: { ret: TopupReturn | null }) {
	const { billing, burn, service, usage, daily, caps, credits, status } =
		useAccountData();
	const { data: allInsights } = useInsights();
	const st = useTopupReturn(ret);
	const co = useCheckout();
	const compact = useCompact();
	const capSave = useSave<number | null>((next) =>
		updateCap(next == null ? null : next * 100),
	);
	const now = new Date();
	const month = monthParam(currentUtcMonth(now));
	// Whether the page came with this month's usage, fixed at mount: a later
	// refresh must not restart the poll.
	const [usageSeeded] = useState(usage[month] !== undefined);

	useEffect(() => {
		ensureBilling();
		ensureCaps();
		ensureCredits();
		preloadSpendChart();
	}, []);

	// A landed top-up is a new row in the credits list.
	const landed = st?.kind === "landed";
	useEffect(() => {
		if (landed) refreshCredits();
	}, [landed]);

	// Every 60s while the tab is visible, refresh the month's usage. This is
	// also how `burn` and `service` (always "now") stay live.
	useEffect(() => {
		return poll(
			async () => {
				await refreshUsage(month);
				return {};
			},
			60_000,
			{ immediate: !usageSeeded },
		);
	}, [month, usageSeeded]);

	// What is stored, and while a save is out, what it will be.
	const storedCapUsd = capDollars(caps?.monthlyCapCents ?? null);
	const pendingCap = capSave.pending;
	const capUsd = pendingCap !== undefined ? pendingCap : storedCapUsd;

	async function changeCap(next: number | null) {
		const prev = storedCapUsd;
		const outcome = await capSave.run(next);
		// A newer save of the cap is out: its answer is the one to report.
		if (outcome === "stale") return;
		if (outcome === "failed") {
			// Take whatever the server has, in case an earlier save landed.
			refreshCaps();
			notify.fail("Couldn't save your spend cap", {
				desc:
					prev == null
						? "Nothing changed."
						: `Nothing changed. Your cap is still $${prev}.`,
				retry: () => changeCap(next),
			});
			return;
		}
		notify.done(
			next == null ? "Spend cap removed" : `Spend cap set to $${next}`,
			{
				desc:
					next == null
						? undefined
						: "Deliveries pause if this month reaches it.",
				undo: () => changeCap(prev),
				quick: true,
			},
		);
	}

	if (compact) {
		return (
			<>
				<AccountCompactHeader current="usage" />
				<UsageCompact
					now={now}
					billing={billing}
					capUsd={capUsd}
					capPending={caps === null}
					alertPct={caps?.alertThresholdPct}
					usage={usage[month]}
					daily={daily[month]}
					burn={burn}
					service={service}
					notice={st ? <ReturnNotice st={st} billing={billing} /> : null}
					co={co}
				/>
			</>
		);
	}

	const stopped =
		stackStatus({
			service: service?.state ?? null,
			read: null,
			creditsUsdMicros: billing?.creditsUsdMicros ?? null,
		}) === "stopped_no_credits";
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
			onRetryCredits={status.credits === "error" ? refreshCredits : undefined}
			insights={forAccountRules(allInsights, BILLING_RULES)}
			notice={st ? <ReturnNotice st={st} billing={billing} /> : null}
			addCredits={
				<AddCredits
					band
					co={co}
					billing={billing}
					burn={burn}
					stopped={stopped}
				/>
			}
			settings={
				<LimitsAndEmails
					capUsd={capUsd}
					onCapChange={changeCap}
					spentUsd={
						billing ? Number(billing.spentThisMonthUsdMicros) / MICROS : 0
					}
				/>
			}
		/>
	);
}
