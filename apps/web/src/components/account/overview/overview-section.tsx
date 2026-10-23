"use client";

import { Meter } from "@/components/dashboard/charts/meter";
import { Ticks } from "@/components/dashboard/charts/ticks";
import { InsightActions } from "@/components/dashboard/insight/insight-actions";
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
	type Caps,
	ensureApps,
	formatUsd,
	refreshBilling,
	refreshCaps,
	refreshKeys,
	refreshRows,
	refreshUsage,
	useAccountData,
} from "@/lib/account-data";
import { daysLeft, daysLeftLabel } from "@/lib/account-health";
import { useAuth } from "@/lib/auth";
import type { Insight } from "@/lib/insights";
import { useInsights } from "@/lib/insights-store";
import {
	type KeyState,
	type OnboardingProgress,
	keyState,
	onboardingProgress,
	onboardingSkipped,
	skipOnboarding,
} from "@/lib/onboarding";
import type { RowsResponse } from "@/lib/rows";
import { useSubgraphsCache } from "@/lib/subgraphs-store";
import type { ApiKey, ConnectedApp } from "@/lib/types";
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
import { FirstRowsGuide } from "./first-rows-guide";
import { KeysBlock } from "./keys-block";
import { stoppedForCredits } from "./overview-view";
import { TerminalBlock } from "./terminal-block";
import { TopNote } from "./top-note";
import { UsageBlock } from "./usage-block";

/** The webhook rows refresh this often while the tab is visible. */
const POLL_MS = 30_000;

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
	/** Step 2's guide: a prompt, then one read three ways. */
	firstRows?: ReactNode;
}

export function onboardingSteps({
	progress,
	keyName,
	firstRows,
}: OverviewOnboarding) {
	const current = !progress.key ? 0 : 1;
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
			body: "Straight from the chain, decoded.",
			done: progress.read,
			current: current === 1,
			extra: firstRows,
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
	return (
		<StatusSentence
			tone="ok"
			sub="One call, three ways to make it. Or hand it to a coding assistant."
		>
			Your key works. Read your first rows.
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
	/** Every insight the account holds; the top note shows the worst open one. */
	insights?: readonly Insight[];
	/** Connected apps (hosted MCP sign-ins); null until they have loaded. */
	apps?: ConnectedApp[] | null;
	/** The spend cap; null until it has loaded. */
	caps?: Caps | null;
	/** The hosted stack stopped because every webhook is paused. */
	asleep?: boolean;
	/** A new account's checklist; the normal Overview shows once it is complete. */
	onboarding?: OverviewOnboarding | null;
}

/** The Account page head: the title and what the page is for. */
function PageHead() {
	return (
		<header className="ov-head">
			<h1>Account</h1>
			<p>
				You create and change things from the CLI, the SDK or a coding
				assistant. This page shows what&apos;s running, what it costs, and the
				keys that read.
			</p>
		</header>
	);
}

/** The Account page: a top note when something needs you, then what is running, what it costs, and the keys. */
export function OverviewBody({
	rows,
	billing,
	burn,
	stack,
	readUsage = null,
	subgraphs = <OverviewSubgraphsSlot />,
	keys = null,
	apps = null,
	caps = null,
	now = new Date(),
	insights = [],
	asleep = false,
	onboarding = null,
	loading = false,
}: OverviewBodyProps) {
	const guide = onboarding && !onboarding.progress.complete ? onboarding : null;
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
	const failing = creditsOut
		? []
		: (rows ?? [])
				.filter((r) => r.state.tone === "alarm")
				.map((r) => ({ id: r.webhook.id, name: r.webhook.name }));
	const accountState = creditsOut
		? "credits_out"
		: rows === null && asleep
			? "asleep"
			: null;

	if (loading) {
		// Nothing renders below the rows: anything there would be an
		// existing element that moves when the real ones replace this.
		return (
			<div className="ov-page">
				<PageHead />
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
			</div>
		);
	}

	const sections = (
		<>
			<TopNote insights={insights} failing={failing} state={accountState} />

			{rows !== null && rows.length > 0 ? (
				<section className="ov-section" aria-label="Webhooks">
					<div className="ov-section-h">
						<h2>Webhooks</h2>
						<span className="dash-label">Last 24h</span>
					</div>
					<div key="ov-rows" className="dash-rows ov-table">
						<ResourceRowHead labels={WEBHOOK_HEAD} />
						{active.map((model) => (
							<WebhookRow
								key={model.webhook.id}
								model={model}
								stopped={creditsOut}
							/>
						))}
						<QuietGroup models={quiet} />
					</div>
					<CliLine label="Add one" command="sl webhooks create --help" />
				</section>
			) : null}

			<section className="ov-section" aria-label="Subgraphs">
				<div className="ov-section-h">
					<h2>Subgraphs</h2>
				</div>
				<div className="dash-rows ov-table">{subgraphs}</div>
				<CliLine label="Deploy one" command="sl subgraphs deploy --help" />
			</section>

			<UsageBlock
				readUsage={readUsage}
				billing={billing}
				burn={burn}
				caps={caps}
				stopped={stack?.state === "stopped"}
				now={now}
			/>
			<TerminalBlock />
			<KeysBlock keys={keys} apps={apps} now={now} />
		</>
	);

	if (guide) {
		return (
			<div className="ov-page">
				<OnboardingSentence progress={guide.progress} />
				{guide.flow}
				<Checklist steps={onboardingSteps(guide)} />
				{guide.progress.key ? (
					sections
				) : (
					<>
						<PlaceholderRows
							rows={OVERVIEW_PLACEHOLDERS}
							note="These fill in as you go."
						/>
						<MonthPanel billing={billing} burn={burn} fresh />
					</>
				)}
			</div>
		);
	}

	return (
		<div className="ov-page">
			<PageHead />
			{sections}
		</div>
	);
}

/**
 * The checklist is for an account that has not started: no key yet, or a key
 * that has not read. The first read, the first webhook or subgraph, or Skip
 * ends it for good. An account whose keys are all revoked gets the normal
 * screens; the name-a-key flow stays up until its Done.
 */
export function checklistApplies(
	state: KeyState,
	flowOpen: boolean,
	underway: boolean,
): boolean {
	return state === "first" || flowOpen || (state === "active" && !underway);
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
	accountId,
	firstRowsCode,
	firstRowsPrompt,
}: {
	keys: ApiKey[] | null;
	now: Date;
	pushed: boolean;
	settled: boolean;
	accountId: string | null;
	firstRowsCode?: ReactNode;
	firstRowsPrompt?: ReactNode;
}): OverviewOnboarding | null {
	const progress = onboardingProgress(keys, now, pushed);
	const state = keyState(keys, now);
	const [flowOpen, setFlowOpen] = useState(false);
	const [made, setMade] = useState<string | null>(null);
	const [skipped, setSkipped] = useState(false);
	useEffect(() => {
		if (accountId) setSkipped(onboardingSkipped(accountId));
	}, [accountId]);
	// The flow opens the first time we see an account that never had a key, and
	// stays open when that changes under it.
	if (state === "first" && !flowOpen && made === null) {
		setFlowOpen(true);
	}
	if (
		keys === null ||
		!checklistApplies(state, flowOpen, progress.complete || skipped)
	)
		return null;
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
		firstRows:
			firstRowsCode && accountId ? (
				<FirstRowsGuide
					code={firstRowsCode}
					prompt={firstRowsPrompt}
					onSkip={() => {
						skipOnboarding(accountId);
						setSkipped(true);
					}}
				/>
			) : undefined,
	};
}

/** /account: is everything running, what needs you, what it costs. The
 *  first-rows blocks are server-rendered by the page and passed in. */
export function OverviewSection({
	firstRowsCode,
	firstRowsPrompt,
}: { firstRowsCode?: ReactNode; firstRowsPrompt?: ReactNode } = {}) {
	const { account } = useAuth();
	const {
		billing,
		burn,
		keys,
		apps,
		caps,
		service,
		rows: rowsData,
	} = useAccountData();
	const { rows } = useWebhookRows();
	const { data: insights, status: insightsStatus } = useInsights();
	const month = monthParam(currentUtcMonth());

	useEffect(() => {
		refreshBilling();
		refreshCaps();
		refreshKeys();
		ensureApps();
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
		accountId: account?.id ?? null,
		firstRowsCode,
		firstRowsPrompt,
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
			apps={apps}
			caps={caps}
			insights={insights}
			asleep={asleep}
			onboarding={onboarding}
		/>
	);
}
