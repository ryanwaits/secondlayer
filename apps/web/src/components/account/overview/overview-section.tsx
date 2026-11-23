"use client";

import { Meter } from "@/components/dashboard/charts/meter";
import { Ticks } from "@/components/dashboard/charts/ticks";
import { InsightLine } from "@/components/dashboard/insight/insight-line";
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
import { IntentLink } from "@/components/intent-link";
import {
	type Billing,
	ensureBilling,
	ensureCaps,
	ensureKeys,
	formatUsd,
	refreshRows,
	refreshUsage,
	useAccountData,
} from "@/lib/account-data";
import { daysLeft, daysLeftLabel } from "@/lib/account-health";
import { useAuth } from "@/lib/auth";
import { type Insight, rankInsights } from "@/lib/insights";
import { forResource, useInsights } from "@/lib/insights-store";
import {
	type KeyState,
	type OnboardingProgress,
	keyState,
	onboardingProgress,
	onboardingSkipped,
	skipOnboarding,
} from "@/lib/onboarding";
import type { RowsResponse } from "@/lib/rows";
import type {
	SubgraphsListInitial,
	WebhooksListInitial,
} from "@/lib/server/dashboard-reads";
import {
	type SubgraphsSeed,
	listSeed as subgraphsListSeed,
	useSubgraphsCache,
} from "@/lib/subgraphs-store";
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
import {
	poll,
	refreshList,
	refreshSummary,
	listSeed as webhooksListSeed,
} from "@/lib/webhooks-store";
import { type ReactNode, useEffect, useState } from "react";
import { WebhookRoute } from "../index-rows/index-list";
import {
	type RowStatus,
	webhookStatus,
	webhookWhyLine,
} from "../index-rows/status";
import { KEY_FLOW_IDLE, keyFlowOpen } from "../keys/key-flow";
import { countedKeys } from "../keys/key-view";
import { NewKeyFlow, useKeyFlow } from "../keys/new-key-flow";
import {
	OverviewSubgraphsRows,
	OverviewViewAll,
	useSubgraphsPoll,
} from "../subgraphs/list-screen";
import { type WebhookRowModel, useWebhookRows } from "../webhooks/rows";
import { shortenName } from "../webhooks/shared";
import { ageShort, last24 } from "../webhooks/view";
import { WaitingGroups } from "../webhooks/waiting";
import { FirstRowsGuide } from "./first-rows-guide";
import { overviewStackStatus } from "./overview-view";
import { PlumbingStrip, PlumbingStripSkeleton } from "./plumbing-strip";

const POLL_MS = 30_000;

export const WEBHOOK_HEAD: ResourceRowLabels = [
	"Webhooks",
	"State",
	"Deliveries, 24h",
	"Sent, 24h",
	"Last",
];

export const SUBGRAPH_HEAD: ResourceRowLabels = [
	"Subgraphs",
	"State",
	"Rows written, 24h",
	"Rows",
	"Last",
];

export const OVERVIEW_ROWS = 3;

export function OverviewSubgraphsSlot({ seed }: { seed?: SubgraphsSeed } = {}) {
	return (
		<OverviewSubgraphsRows
			head={SUBGRAPH_HEAD}
			seed={seed}
			limit={OVERVIEW_ROWS}
		/>
	);
}

const plural = (n: number, one: string, many = `${one}s`) =>
	`${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function StateCell({
	group,
	text,
}: {
	group: RowStatus["group"];
	text: string;
}) {
	return (
		<span className={`ov-state${group === "alarm" ? " alarm" : ""}`}>
			<span className={`ix-dot ${group}`} />
			<span>{text}</span>
		</span>
	);
}

function WebhookRow({
	model,
	stopped = false,
}: {
	model: WebhookRowModel;
	stopped?: boolean;
}) {
	const { webhook, series, state } = model;
	const recent = last24(series);
	const tone = stopped ? "idle" : state.tone;
	const status = webhookStatus(model);
	const why = webhookWhyLine(model);
	return (
		<ResourceRow
			href={`/account/webhooks/${webhook.id}`}
			name={shortenName(webhook.name)}
			nameTitle={webhook.name}
			tone={tone}
			state={
				stopped ? (
					<StateCell group="idle" text="Not delivering, stack stopped" />
				) : status.label ? (
					<StateCell group={status.group} text={why ?? status.label} />
				) : (
					<WebhookRoute webhook={webhook} />
				)
			}
			spark={
				recent.delivered.length > 0 ? (
					<Ticks
						delivered={recent.delivered}
						failed={recent.failed}
						tone={tone === "hi" ? "att" : undefined}
						title={`${webhook.name}, deliveries per hour, last 24 hours`}
					/>
				) : null
			}
			count={recent.delivered
				.reduce((a, b) => a + b, 0)
				.toLocaleString("en-US")}
			age={ageShort(webhook.lastDeliveryAt)}
		/>
	);
}

export function topFinding(insights: readonly Insight[]): Insight | undefined {
	return rankInsights(insights).find((i) => i.severity !== "recovered");
}

export function overviewFindings(
	webhooks: readonly Pick<WebhookRowModel, "insights">[],
	subgraphs: readonly Insight[],
): Insight[] {
	const tops = webhooks.flatMap((w) => topFinding(w.insights) ?? []);
	return rankInsights([...tops, ...subgraphs]);
}

export function findingsHeadline(findings: readonly Insight[]): string {
	const first = findings[0];
	if (!first) return "";
	const failing = (i: Insight) => i.severity === "losing";
	const same = findings.every(
		(i) =>
			i.resource.kind === first.resource.kind && failing(i) === failing(first),
	);
	const n = findings.length;
	if (!same) return `${n.toLocaleString("en-US")} things need a look.`;
	const noun = plural(n, first.resource.kind);
	if (failing(first)) return `${noun} ${n === 1 ? "is" : "are"} failing.`;
	return `${noun} ${n === 1 ? "needs" : "need"} a look.`;
}

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
	fresh?: boolean;
}) {
	const runway = daysLeftLabel(daysLeft(billing, burn));
	return (
		<section className="dash-panel" aria-label="This month">
			<div className="dash-panel-h">
				<span className="dash-label">{monthLabel(currentUtcMonth())}</span>
				<IntentLink href="/account/credits" className="dash-link">
					Billing ›
				</IntentLink>
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

export interface OverviewOnboarding {
	progress: OnboardingProgress;
	keyName: string | null;
	flow: ReactNode;
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

export function OnboardingSentence({
	progress,
}: { progress: OnboardingProgress }) {
	if (!progress.key) {
		return (
			<StatusSentence sub="The SDK, the CLI and plain HTTP calls all read with it. The first 1M rows each month are free, no card needed.">
				Make a key to start.
			</StatusSentence>
		);
	}
	return (
		<StatusSentence sub="One call, three ways to make it. Or hand it to a coding assistant.">
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

export interface OverviewFirstWave {
	keys: boolean;
	billing: boolean;
	service: boolean;
	stackState: HostedStack["state"] | null;
	webhooks: boolean;
	asleep: boolean;
	subgraphs: boolean;
	rows: boolean;
	insights: boolean;
}

export interface OverviewPending {
	list: boolean;
	strip: boolean;
	all: boolean;
}

export function overviewPending(w: OverviewFirstWave): OverviewPending {
	const stackless = w.stackState === "none";
	return {
		list:
			!w.keys ||
			!w.insights ||
			!(stackless || ((w.webhooks || w.asleep) && w.subgraphs)),
		strip: !w.insights,
		all:
			!w.keys &&
			!w.billing &&
			!w.service &&
			!w.rows &&
			!w.insights &&
			!w.webhooks &&
			!w.subgraphs,
	};
}

const NOT_PENDING: OverviewPending = { list: false, strip: false, all: false };

const SENTENCE_SKELETON_HEIGHT = 34;

const SKELETON_ROWS = 3;

export interface OverviewBodyProps {
	pending?: OverviewPending;
	rows: WebhookRowModel[] | null;
	billing: Billing | null;
	burn: Burn | null;
	stack: HostedStack | null;
	readUsage?: RowsResponse | null;
	subgraphs?: ReactNode;
	keys?: ApiKey[] | null;
	now?: Date;
	subgraphFindings?: readonly Insight[];
	inbox?: readonly Insight[];
	asleep?: boolean;
	onboarding?: OverviewOnboarding | null;
}

export function OverviewBody({
	rows,
	billing,
	burn,
	stack,
	readUsage = null,
	subgraphs = <OverviewSubgraphsSlot />,
	keys = null,
	now = new Date(),
	subgraphFindings = [],
	inbox = [],
	asleep = false,
	onboarding = null,
	pending = NOT_PENDING,
}: OverviewBodyProps) {
	const guide = onboarding && !onboarding.progress.complete ? onboarding : null;
	const findings = overviewFindings(rows ?? [], subgraphFindings);
	const active = (
		rows?.filter((r) => r.webhook.lastDeliveryAt !== null) ?? []
	).sort(
		(a, b) =>
			Date.parse(b.webhook.lastDeliveryAt ?? "") -
			Date.parse(a.webhook.lastDeliveryAt ?? ""),
	);
	const quiet = rows?.filter((r) => r.webhook.lastDeliveryAt === null) ?? [];
	// Credits ran out and the hosted stack stopped. The webhooks aren't at
	// fault, so their rows go idle instead of red.
	const creditsOut =
		stack !== null &&
		billing !== null &&
		overviewStackStatus(stack, {
			asleep,
			creditsUsdMicros: billing.creditsUsdMicros,
		}) === "stopped_no_credits";

	const sub = [
		rows ? plural(rows.length, "webhook") : null,
		billing ? `${formatUsd(billing.creditsUsdMicros)} in credits` : null,
	]
		.filter(Boolean)
		.join(" · ");

	const listSection = pending.list ? (
		<>
			<StatusSentence sub={<Skel width={220} />}>
				{pending.all ? (
					"Checking your account."
				) : (
					<Skel width={300} height={SENTENCE_SKELETON_HEIGHT} />
				)}
			</StatusSentence>
			<output
				key="ov-skel"
				className="dash-rows ov-skel"
				aria-busy="true"
				aria-label="Loading your account"
			>
				<ResourceRowHead labels={WEBHOOK_HEAD} />
				{Array.from({ length: SKELETON_ROWS }).map((_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
					<ResourceRowSkeleton key={i} />
				))}
			</output>
		</>
	) : (
		<>
			{guide ? (
				<>
					<OnboardingSentence progress={guide.progress} />
					{guide.flow}
					<Checklist steps={onboardingSteps(guide)} />
				</>
			) : creditsOut ? (
				<StatusSentence sub="Credits ran out, so webhooks aren't delivering. Add credits to start it again.">
					Your hosted stack stopped.
				</StatusSentence>
			) : rows === null && asleep ? (
				<StatusSentence sub="Every webhook is paused, so it isn't billed. Wake it from Webhooks.">
					Your hosted stack is asleep.
				</StatusSentence>
			) : rows === null ? (
				<StatusSentence sub={sub || undefined}>
					Checking your account.
				</StatusSentence>
			) : findings.length > 0 ? (
				<StatusSentence sub={sub}>{findingsHeadline(findings)}</StatusSentence>
			) : rows.length === 0 ? (
				<StatusSentence sub={sub}>No webhooks yet.</StatusSentence>
			) : (
				<StatusSentence sub={sub}>Everything is delivering.</StatusSentence>
			)}

			{guide && !guide.progress.key ? (
				<PlaceholderRows
					rows={OVERVIEW_PLACEHOLDERS}
					note="These fill in as you go."
				/>
			) : (
				<>
					<InsightLine insights={inbox} inbox className="ov-inbox" />
					<div key="ov-rows" className="dash-rows ov-table">
						{active.length + quiet.length > 0 ? (
							<ResourceRowHead labels={WEBHOOK_HEAD} />
						) : null}
						{active.slice(0, OVERVIEW_ROWS).map((model) => (
							<WebhookRow
								key={model.webhook.id}
								model={model}
								stopped={creditsOut}
							/>
						))}
						<QuietGroup models={quiet} />
						{active.length + quiet.length > OVERVIEW_ROWS ? (
							<OverviewViewAll
								total={active.length + quiet.length}
								noun="webhooks"
								href="/account/webhooks"
							/>
						) : null}
						{subgraphs}
					</div>
				</>
			)}
		</>
	);

	const starting = guide !== null && !guide.progress.key;
	return (
		<>
			{listSection}
			{/* Nothing renders under the rows while they load: the strip would
			    move, data or skeleton, when the real rows replace theirs. */}
			{pending.list || starting ? null : pending.strip ? (
				<PlumbingStripSkeleton />
			) : (
				<PlumbingStrip
					rows={readUsage}
					keys={keys}
					stack={stack}
					burn={burn}
					now={now}
					asleep={asleep}
					creditsUsdMicros={billing?.creditsUsdMicros ?? null}
				/>
			)}

			{pending.list || pending.strip ? null : (
				<MonthPanel billing={billing} burn={burn} fresh={starting} />
			)}
		</>
	);
}

export function checklistApplies(
	state: KeyState,
	flowOpen: boolean,
	underway: boolean,
): boolean {
	return state === "first" || flowOpen || (state === "active" && !underway);
}

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
	const [flow, dispatch] = useKeyFlow(KEY_FLOW_IDLE, state === "first");
	const flowOpen = keyFlowOpen(flow);
	const [made, setMade] = useState<string | null>(null);
	const [skipped, setSkipped] = useState(false);
	useEffect(() => {
		if (accountId) setSkipped(onboardingSkipped(accountId));
	}, [accountId]);
	if (
		keys === null ||
		!checklistApplies(state, flowOpen, progress.complete || skipped)
	)
		return null;
	// The key being made flips progress.key; its reveal must outlive that.
	if (!settled && progress.key && !flowOpen) return null;

	const newest = countedKeys(keys, now).at(-1);
	return {
		progress,
		keyName: made ?? newest?.name ?? null,
		flow: flowOpen ? (
			<NewKeyFlow
				flow={flow}
				dispatch={dispatch}
				dismissible={false}
				onCreated={(_key, name) => setMade(name)}
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

export interface OverviewInitial {
	webhooks: WebhooksListInitial;
	subgraphs: SubgraphsListInitial;
}

export function OverviewSection({
	firstRowsCode,
	firstRowsPrompt,
	initial = null,
}: {
	firstRowsCode?: ReactNode;
	firstRowsPrompt?: ReactNode;
	initial?: OverviewInitial | null;
} = {}) {
	const { account } = useAuth();
	const {
		billing,
		burn,
		keys,
		service,
		rows: rowsData,
		usage,
	} = useAccountData();
	const webhooksSeed = initial ? webhooksListSeed(initial.webhooks) : undefined;
	const subgraphsSeed = initial
		? subgraphsListSeed(initial.subgraphs)
		: undefined;
	const { rows } = useWebhookRows(webhooksSeed);
	const { data: insights, status: insightsStatus } = useInsights();
	const month = monthParam(currentUtcMonth());
	const [usageSeeded] = useState(usage[month] !== undefined);
	const [rowsSeeded] = useState(rowsData !== null);

	useEffect(() => {
		ensureBilling();
		ensureCaps();
		ensureKeys();
	}, []);

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

	// The Rows (reads) row's data. Polled here, not in its slot, which is not
	// mounted while the first-paint skeleton is up.
	useEffect(
		() =>
			poll(
				async () => {
					await refreshRows();
					return {};
				},
				60_000,
				{ immediate: !rowsSeeded },
			),
		[rowsSeeded],
	);

	// A read never starts or wakes a hosted stack (the gateway answers an
	// account with no stack with an empty list), so asking right away is free.
	const [asleep, setAsleep] = useState(
		initial?.webhooks.list.kind === "asleep",
	);
	const webhooksLoaded =
		initial?.webhooks.list.kind === "ok" &&
		initial.webhooks.summary.kind === "ok";
	useEffect(() => {
		return poll(
			async () => {
				const [list] = await Promise.all([refreshList(), refreshSummary()]);
				setAsleep(list.kind === "asleep");
				return list.kind === "starting" || list.kind === "rate_limited"
					? { retryAfterMs: list.retryAfter * 1000 }
					: {};
			},
			POLL_MS,
			{ immediate: !webhooksLoaded },
		);
	}, [webhooksLoaded]);

	useSubgraphsPoll(initial?.subgraphs);

	const subgraphs = useSubgraphsCache(subgraphsSeed).list;
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

	const pending = overviewPending({
		keys: keys !== null,
		billing: billing !== null,
		service: service !== null,
		stackState: service?.state ?? null,
		webhooks: rows !== null,
		asleep,
		subgraphs: subgraphs !== undefined,
		rows: rowsData !== null,
		insights: insightsStatus !== "idle",
	});

	const subgraphFindings = (subgraphs?.data ?? []).flatMap(
		(item) => topFinding(forResource(insights, "subgraph", item.name)) ?? [],
	);

	return (
		<OverviewBody
			pending={pending}
			subgraphs={<OverviewSubgraphsSlot seed={subgraphsSeed} />}
			rows={rows ?? (service?.state === "none" ? [] : null)}
			billing={billing}
			burn={burn}
			stack={service}
			readUsage={rowsData}
			keys={keys}
			subgraphFindings={subgraphFindings}
			inbox={insights.filter((i) => i.severity !== "recovered")}
			asleep={asleep}
			onboarding={onboarding}
		/>
	);
}
