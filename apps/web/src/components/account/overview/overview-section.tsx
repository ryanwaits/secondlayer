"use client";

import { Meter } from "@/components/dashboard/charts/meter";
import { Ticks } from "@/components/dashboard/charts/ticks";
import {
	ActionableInsights,
	InsightActions,
} from "@/components/dashboard/insight/insight-actions";
import { InsightCard } from "@/components/dashboard/insight/insight-card";
import {
	Checklist,
	type ChecklistStep,
	PlaceholderRows,
} from "@/components/dashboard/shell/onboarding";
import {
	ResourceRow,
	ResourceRowHead,
	type ResourceRowLabels,
	ResourceRowSkeleton,
} from "@/components/dashboard/shell/resource-row";
import { Skel } from "@/components/dashboard/shell/skel";
import { StatusSentence } from "@/components/dashboard/shell/status-sentence";
import {
	type Billing,
	formatUsd,
	refreshBilling,
	refreshCaps,
	refreshKeys,
	refreshRows,
	refreshUsage,
	useAccountData,
} from "@/lib/account-data";
import { daysLeft, daysLeftLabel } from "@/lib/account-health";
import type { Insight } from "@/lib/insights";
import { forAccountRules, useInsights } from "@/lib/insights-store";
import {
	type KeyState,
	type OnboardingProgress,
	READ_COMMAND,
	keyState,
	onboardingProgress,
} from "@/lib/onboarding";
import type { RowsResponse } from "@/lib/rows";
import { useSubgraphsCache } from "@/lib/subgraphs-store";
import type { ApiKey } from "@/lib/types";
import {
	type Burn,
	type HostedStack,
	ROWS_ALLOWANCE,
	currentUtcMonth,
	formatRows,
	monthLabel,
	monthParam,
	nextMonthLabel,
} from "@/lib/usage";
import { useFirstSettle } from "@/lib/use-first-settle";
import { poll, refreshList, refreshSummary } from "@/lib/webhooks-store";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { countedKeys } from "../keys/key-view";
import { NewKeyFlow } from "../keys/new-key-flow";
import {
	OverviewSubgraphsRows,
	useSubgraphsPoll,
} from "../subgraphs/list-screen";
import {
	StateCell,
	type WebhookRowModel,
	useWebhookRows,
} from "../webhooks/rows";
import { CliLine, shortenName } from "../webhooks/shared";
import { ageShort, last24 } from "../webhooks/view";
import { WaitingGroups } from "../webhooks/waiting";
import { cellInsights, stoppedForCredits } from "./overview-view";
import { PlumbingStrip, PlumbingStripSkeleton } from "./plumbing-strip";

/** The webhook rows refresh this often while the tab is visible. */
const POLL_MS = 30_000;

/** The account-level rules the Overview shows; the rest belong to Rows. */
export const OVERVIEW_ACCOUNT_RULES = [
	"server_errors",
	"cap_pace",
	"credits_runway",
	"revoked_key_in_use",
	"stack_unreachable",
];

/** The column labels over the webhook rows; they name the unit the numbers count. */
export const WEBHOOK_HEAD: ResourceRowLabels = [
	"Webhooks",
	"State",
	"Deliveries, 24h",
	"Sent, 24h",
	"Last",
];

/** The subgraph rows' own header: they count rows written, not deliveries. */
export const SUBGRAPH_HEAD: ResourceRowLabels = [
	"Subgraphs",
	"State",
	"Rows written, 24h",
	"Rows",
	"Last",
];

/** One row per subgraph, under their own header. Empty until the Overview's
 *  poll has loaded the list, and for an account with no subgraphs. */
export function OverviewSubgraphsSlot() {
	return <OverviewSubgraphsRows head={SUBGRAPH_HEAD} />;
}

const plural = (n: number, one: string, many = `${one}s`) =>
	`${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function WebhookRow({
	model,
	stopped = false,
}: {
	model: WebhookRowModel;
	/** The hosted stack is stopped: nothing is delivering, and the webhook isn't at fault. */
	stopped?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const { webhook, series, state, insights } = model;
	const recent = last24(series);
	const top = insights[0];
	return (
		<div className="dash-row-wrap">
			<ResourceRow
				href={`/account/webhooks/${webhook.id}`}
				name={shortenName(webhook.name)}
				nameTitle={webhook.name}
				tone={stopped ? "idle" : state.tone}
				state={
					stopped ? (
						"Not delivering, stack stopped"
					) : (
						<StateCell
							model={model}
							open={open}
							onToggle={() => setOpen((v) => !v)}
						/>
					)
				}
				spark={
					recent.delivered.length > 0 ? (
						<Ticks
							delivered={recent.delivered}
							failed={recent.failed}
							title={`${webhook.name}, deliveries per hour, last 24 hours`}
						/>
					) : null
				}
				count={recent.delivered
					.reduce((a, b) => a + b, 0)
					.toLocaleString("en-US")}
				age={ageShort(webhook.lastDeliveryAt)}
			/>
			{open && top ? (
				<InsightCard insight={top} footer={<InsightActions insight={top} />} />
			) : null}
		</div>
	);
}

/** Webhooks that have never matched an event: one quiet row that expands. */
function QuietGroup({ models }: { models: WebhookRowModel[] }) {
	const [open, setOpen] = useState(false);
	if (models.length === 0) return null;
	return (
		<div className="dash-row-wrap">
			<button
				type="button"
				className="dash-row ov-group"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
			>
				<span className="dash-row-name">
					<span className="dash-dot idle" />
					<span>{plural(models.length, "more webhook")}</span>
				</span>
				<span className="dash-row-state">Waiting for a first match</span>
				<span className="dash-row-spark" />
				<span className="dash-row-v ov-faint">0</span>
				<span className="dash-row-t ov-faint">{open ? "▴" : "▾"}</span>
			</button>
			{open ? (
				<div className="ov-sub-rows">
					<WaitingGroups webhooks={models.map((m) => m.webhook)} />
				</div>
			) : null}
		</div>
	);
}

function MonthPanel({
	billing,
	burn,
	fresh = false,
}: {
	billing: Billing | null;
	burn: Burn | null;
	/** A new account: nothing spent, nothing to pay, the free rows untouched. */
	fresh?: boolean;
}) {
	const runway = daysLeftLabel(daysLeft(billing, burn));
	return (
		<section className="dash-panel" aria-label="This month">
			<div className="dash-panel-h">
				<span className="dash-label">{monthLabel(currentUtcMonth())}</span>
				<Link href="/account/credits" className="dash-link">
					Billing ›
				</Link>
			</div>
			{fresh ? (
				<>
					<div className="dash-big">
						$0.00 <span>spent · nothing to pay</span>
					</div>
					<Meter
						used={0}
						total={ROWS_ALLOWANCE}
						label="Free rows used this month"
						left={`0 of ${formatRows(ROWS_ALLOWANCE)} free rows`}
						right={`resets ${nextMonthLabel(currentUtcMonth())}`}
					/>
				</>
			) : (
				// The strip's Rows cell carries the meter; this panel is the money.
				<div className="dash-big">
					{billing ? formatUsd(billing.spentThisMonthUsdMicros) : "–"}{" "}
					<span>
						spent
						{billing
							? ` · ${formatUsd(billing.creditsUsdMicros)} left${runway ? `, ${runway}` : ""}`
							: ""}
					</span>
				</div>
			)}
		</section>
	);
}

/** Where a new account is, for the Overview's checklist. */
export interface OverviewOnboarding {
	progress: OnboardingProgress;
	/** The key just made, or the newest one, for "<name> is ready". */
	keyName: string | null;
	/** The name-a-key flow, while it is open. */
	flow: ReactNode;
}

export function onboardingSteps({ progress, keyName }: OverviewOnboarding) {
	const current = !progress.key ? 0 : !progress.read ? 1 : 2;
	const steps: ChecklistStep[] = [
		{
			title: "Make a key",
			body: progress.key
				? `${keyName ?? "Your key"} is ready. It's in Keys whenever you need another.`
				: "One per place it runs: your laptop, CI, an agent.",
			done: progress.key,
			current: current === 0,
		},
		{
			title: "Read your first rows",
			body: "Five sBTC and token transfers, straight from the chain. Rows are free up to 1M a month.",
			done: progress.read,
			current: current === 1,
			extra: <CliLine command={READ_COMMAND} />,
		},
		{
			title: "Get events pushed to you",
			body: (
				<>
					A <Link href="/account/webhooks">webhook</Link> posts them to your
					server. A <Link href="/account/subgraphs">subgraph</Link> turns them
					into your own tables.
				</>
			),
			done: progress.push,
			current: current === 2,
		},
	];
	return steps;
}

/** The sentence and sub-line over a new account's checklist. */
export function OnboardingSentence({
	progress,
}: { progress: OnboardingProgress }) {
	if (!progress.key) {
		return (
			<StatusSentence
				tone="idle"
				sub="The SDK, the CLI and plain HTTP calls all read with it. The first 1M rows each month are free, no card needed."
			>
				Make a key to start.
			</StatusSentence>
		);
	}
	if (!progress.read) {
		return (
			<StatusSentence
				tone="ok"
				sub="Your first read shows up under Rows within a minute."
			>
				Your key works. Read something with it.
			</StatusSentence>
		);
	}
	return (
		<StatusSentence
			tone="ok"
			sub="A webhook posts them to your server. A subgraph turns them into your own tables."
		>
			Your key is reading. Get events pushed to you next.
		</StatusSentence>
	);
}

const OVERVIEW_PLACEHOLDERS = [
	{ state: 72, count: 40 },
	{ state: 58, count: 52 },
	{ state: 66, count: 34 },
	{ state: 48, count: 44 },
];

/** What the Overview's first paint waits for. Each field is whether that data has loaded (or is known not to exist). */
export interface OverviewFirstWave {
	keys: boolean;
	billing: boolean;
	/** The usage response, which carries the hosted stack state. */
	service: boolean;
	/** "none" means no hosted stack: no webhooks or subgraphs to wait for. */
	stackState: HostedStack["state"] | null;
	webhooks: boolean;
	asleep: boolean;
	subgraphs: boolean;
	rows: boolean;
	insights: boolean;
}

export function overviewSettled(w: OverviewFirstWave): boolean {
	if (!w.keys || !w.billing || !w.service || !w.rows || !w.insights) {
		return false;
	}
	if (w.stackState === "none") return true;
	return (w.webhooks || w.asleep) && w.subgraphs;
}

/** How many placeholder rows the first-paint skeleton shows. */
const SKELETON_ROWS = 3;

export interface OverviewBodyProps {
	/** Hold the skeleton: the first data has not landed yet. */
	loading?: boolean;
	/** Null until the webhook list has loaded. */
	rows: WebhookRowModel[] | null;
	billing: Billing | null;
	burn: Burn | null;
	stack: HostedStack | null;
	/** This month's reads (the Rows cell); null until they have loaded. */
	readUsage?: RowsResponse | null;
	/** The subgraph rows under their own header; defaults to the ones the Overview's poll loads. */
	subgraphs?: ReactNode;
	/** The account's API keys; null until they have loaded. */
	keys?: ApiKey[] | null;
	/** The clock for the keys row; defaults to now. */
	now?: Date;
	/** Account-level insights (read errors, spend cap, credits). */
	accountInsights?: readonly Insight[];
	/** The hosted stack stopped because every webhook is paused. */
	asleep?: boolean;
	/** A new account's checklist; the normal Overview shows once it is complete. */
	onboarding?: OverviewOnboarding | null;
}

/** The Overview: one sentence, a row per webhook and subgraph, the strip under them, and the month. */
export function OverviewBody({
	rows,
	billing,
	burn,
	stack,
	readUsage = null,
	subgraphs = <OverviewSubgraphsSlot />,
	keys = null,
	now = new Date(),
	accountInsights = [],
	asleep = false,
	onboarding = null,
	loading = false,
}: OverviewBodyProps) {
	const guide = onboarding && !onboarding.progress.complete ? onboarding : null;
	const attention = rows?.filter((r) => r.state.tone === "alarm").length ?? 0;
	const active = rows?.filter((r) => r.webhook.lastDeliveryAt !== null) ?? [];
	const quiet = rows?.filter((r) => r.webhook.lastDeliveryAt === null) ?? [];
	// Credits ran out and the hosted stack stopped. The webhooks aren't at
	// fault, so their rows go idle instead of red.
	const creditsOut =
		stack !== null &&
		billing !== null &&
		stoppedForCredits(stack, {
			asleep,
			creditsUsdMicros: billing.creditsUsdMicros,
		});
	const { rest: moneyInsights } = cellInsights(accountInsights);

	const sub = [
		rows ? plural(rows.length, "webhook") : null,
		billing ? `${formatUsd(billing.creditsUsdMicros)} in credits` : null,
	]
		.filter(Boolean)
		.join(" · ");

	if (loading) {
		// Nothing renders below the strip: anything there would be an
		// existing element that moves when the real ones replace this.
		return (
			<>
				<StatusSentence tone="idle" sub={<Skel width={220} />}>
					Checking your account.
				</StatusSentence>
				<output
					key="ov-skel"
					className="dash-rows ov-skel"
					aria-busy="true"
					aria-label="Loading your account"
				>
					<ResourceRowHead labels={WEBHOOK_HEAD} />
					{Array.from({ length: SKELETON_ROWS }).map((_, i) => (
						// Fixed skeleton row count; position is the identity.
						// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
						<ResourceRowSkeleton key={i} />
					))}
				</output>
				<PlumbingStripSkeleton />
			</>
		);
	}

	return (
		<>
			{guide ? (
				<>
					<OnboardingSentence progress={guide.progress} />
					{guide.flow}
					<Checklist steps={onboardingSteps(guide)} />
				</>
			) : creditsOut ? (
				<StatusSentence
					tone="alarm"
					sub="Credits ran out, so webhooks aren't delivering. Add credits to start it again."
				>
					Your hosted stack stopped.
				</StatusSentence>
			) : rows === null && asleep ? (
				<StatusSentence
					tone="idle"
					sub="Every webhook is paused, so it isn't billed. Wake it from Webhooks."
				>
					Your hosted stack is asleep.
				</StatusSentence>
			) : rows === null ? (
				<StatusSentence tone="idle" sub={sub || undefined}>
					Checking your account.
				</StatusSentence>
			) : attention > 0 ? (
				<StatusSentence tone="alarm" sub={sub}>
					{plural(attention, "webhook")} {attention === 1 ? "needs" : "need"}{" "}
					attention.
				</StatusSentence>
			) : rows.length === 0 ? (
				<StatusSentence tone="idle" sub={sub}>
					No webhooks yet.
				</StatusSentence>
			) : (
				<StatusSentence tone="ok" sub={sub}>
					Everything is delivering.
				</StatusSentence>
			)}

			{guide && !guide.progress.key ? (
				<PlaceholderRows
					rows={OVERVIEW_PLACEHOLDERS}
					note="These fill in as you go."
				/>
			) : (
				<>
					<div key="ov-rows" className="dash-rows ov-table">
						{active.length + quiet.length > 0 ? (
							<ResourceRowHead labels={WEBHOOK_HEAD} />
						) : null}
						{active.map((model) => (
							<WebhookRow
								key={model.webhook.id}
								model={model}
								stopped={creditsOut}
							/>
						))}
						<QuietGroup models={quiet} />
						{subgraphs}
					</div>
					<PlumbingStrip
						rows={readUsage}
						keys={keys}
						stack={stack}
						burn={burn}
						now={now}
						insights={accountInsights}
						asleep={asleep}
						creditsUsdMicros={billing?.creditsUsdMicros ?? null}
					/>
				</>
			)}

			<ActionableInsights insights={moneyInsights} />

			<MonthPanel
				billing={billing}
				burn={burn}
				fresh={guide !== null && !guide.progress.key}
			/>
		</>
	);
}

/**
 * The checklist is for an account that has never made a key. Once one exists
 * (made just now, or long ago and maybe revoked since), the Overview shows its
 * normal screens; the name-a-key flow stays up until its Done.
 */
export function checklistApplies(state: KeyState, flowOpen: boolean): boolean {
	return state === "first" || flowOpen;
}

/**
 * The new-account checklist for the Overview, or null when it does not apply.
 * The name-a-key flow stays up through the key being made (the keys list
 * changes under it) until its Done.
 */
function useOnboarding({
	keys,
	now,
	pushed,
	settled,
}: {
	keys: ApiKey[] | null;
	now: Date;
	pushed: boolean;
	settled: boolean;
}): OverviewOnboarding | null {
	const progress = onboardingProgress(keys, now, pushed);
	const state = keyState(keys, now);
	const [flowOpen, setFlowOpen] = useState(false);
	const [made, setMade] = useState<string | null>(null);
	// The flow opens the first time we see an account that never had a key, and
	// stays open when that changes under it.
	if (state === "first" && !flowOpen && made === null) {
		setFlowOpen(true);
	}
	if (keys === null || !checklistApplies(state, flowOpen)) return null;
	if (!settled && progress.key) return null;

	const newest = countedKeys(keys, now).at(-1);
	return {
		progress,
		keyName: made ?? newest?.name ?? null,
		flow: flowOpen ? (
			<NewKeyFlow
				dismissible={false}
				onCreated={(_key, name) => setMade(name)}
				onClose={() => setFlowOpen(false)}
			/>
		) : null,
	};
}

/** /account: is everything running, what needs you, what it costs. */
export function OverviewSection() {
	const { billing, burn, keys, service, rows: rowsData } = useAccountData();
	const { rows } = useWebhookRows();
	const { data: insights, status: insightsStatus } = useInsights();
	const month = monthParam(currentUtcMonth());

	useEffect(() => {
		refreshBilling();
		refreshCaps();
		refreshKeys();
	}, []);

	// Every 60s while the tab is visible, as the usage page does; this is
	// also what keeps burn and the hosted stack's state current.
	useEffect(() => {
		return poll(async () => {
			await refreshUsage(month);
			return {};
		}, 60_000);
	}, [month]);

	// The Rows (reads) row's data. Polled here, not in its slot, which is not
	// mounted while the first-paint skeleton is up.
	useEffect(
		() =>
			poll(async () => {
				await refreshRows();
				return {};
			}, 60_000),
		[],
	);

	// A read never starts or wakes a hosted stack (the gateway answers an
	// account with no stack with an empty list), so asking right away is free.
	const [asleep, setAsleep] = useState(false);
	useEffect(() => {
		return poll(async () => {
			const [list] = await Promise.all([refreshList(), refreshSummary()]);
			setAsleep(list.kind === "asleep");
			return list.kind === "starting" || list.kind === "rate_limited"
				? { retryAfterMs: list.retryAfter * 1000 }
				: {};
		}, POLL_MS);
	}, []);

	// The subgraph list and its health, for the checklist and the rows below.
	useSubgraphsPoll();

	const subgraphs = useSubgraphsCache().list;
	const now = new Date();
	const onboarding = useOnboarding({
		keys,
		now,
		pushed: (rows?.length ?? 0) > 0 || (subgraphs?.data.length ?? 0) > 0,
		// Don't flash the checklist at an account whose webhooks and subgraphs
		// have not loaded yet. An asleep stack never returns its webhook list.
		settled: (rows !== null || asleep) && subgraphs !== undefined,
	});

	const ready = useFirstSettle(
		overviewSettled({
			keys: keys !== null,
			billing: billing !== null,
			service: service !== null,
			stackState: service?.state ?? null,
			webhooks: rows !== null,
			asleep,
			subgraphs: subgraphs !== undefined,
			rows: rowsData !== null,
			insights: insightsStatus !== "idle",
		}),
	);

	return (
		<OverviewBody
			loading={!ready}
			// No hosted stack means no webhooks, so there is nothing to wait for.
			rows={rows ?? (service?.state === "none" ? [] : null)}
			billing={billing}
			burn={burn}
			stack={service}
			readUsage={rowsData}
			keys={keys}
			accountInsights={forAccountRules(insights, OVERVIEW_ACCOUNT_RULES)}
			asleep={asleep}
			onboarding={onboarding}
		/>
	);
}
