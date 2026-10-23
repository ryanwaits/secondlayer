"use client";

import { Ticks } from "@/components/dashboard/charts/ticks";
import { InsightActions } from "@/components/dashboard/insight/insight-actions";
import { InsightCard } from "@/components/dashboard/insight/insight-card";
import {
	Checklist,
	type ChecklistStep,
} from "@/components/dashboard/shell/onboarding";
import {
	ResourceRow,
	ResourceRowHead,
	type ResourceRowLabels,
	ResourceRowSkeleton,
} from "@/components/dashboard/shell/resource-row";
import { StatusSentence } from "@/components/dashboard/shell/status-sentence";
import { PullRefresh } from "@/components/mobile/pull-refresh";
import {
	type Billing,
	type Caps,
	type TopupReturn,
	ensureApps,
	refreshBilling,
	refreshCaps,
	refreshKeys,
	refreshRows,
	refreshUsage,
	takeTopupReturn,
	useAccountData,
} from "@/lib/account-data";
import { useAuth } from "@/lib/auth";
import type { Insight } from "@/lib/insights";
import { refreshInsights, useInsights } from "@/lib/insights-store";
import {
	type AccountStage,
	accountStage,
	onboardingSkipped,
	skipOnboarding,
} from "@/lib/onboarding";
import type { RowsResponse } from "@/lib/rows";
import { useSubgraphsCache } from "@/lib/subgraphs-store";
import type { ApiKey, ConnectedApp } from "@/lib/types";
import {
	type Burn,
	type HostedStack,
	currentUtcMonth,
	monthParam,
} from "@/lib/usage";
import { useFirstSettle } from "@/lib/use-first-settle";
import { poll, refreshList, refreshSummary } from "@/lib/webhooks-store";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type ReturnState, useTopupReturn } from "../credits-panel";
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
import { CompactOverviewBody } from "./compact-overview";
import { FirstRowsGuide } from "./first-rows-guide";
import { KeysBlock } from "./keys-block";
import { clockTime, stoppedForCredits } from "./overview-view";
import { StartBlock } from "./start-block";
import { CLI_LOGIN_COMMAND, TerminalBlock } from "./terminal-block";
import { TopNote } from "./top-note";
import { UsageBlock } from "./usage-block";
import { type FirstRead, useFirstRead } from "./use-first-read";

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

/** What a new account's views need beyond the stage. */
export interface OverviewOnboarding {
	/** The key just made, or the newest one, for "<name> is ready". */
	keyName: string | null;
	/** The name-a-key flow, while it is open. It stays up through the reveal until Done, in every stage. */
	flow: ReactNode;
	/** Opens the name-a-key flow. */
	onCreateKey: () => void;
	/** The first-rows guide: a prompt, then one read three ways. */
	firstRows?: ReactNode;
}

/** The no-key checklist: make a key, then read. The read waits, faint. */
export function noKeySteps({
	flowOpen,
	onCreateKey,
}: { flowOpen: boolean; onCreateKey: () => void }): ChecklistStep[] {
	return [
		{
			title: "Make a key",
			body: "One per place it runs, so revoking one never breaks the others.",
			done: false,
			current: true,
			extra: (
				<>
					{flowOpen ? null : (
						<div>
							<button
								type="button"
								className="acct-btn solid small"
								onClick={onCreateKey}
							>
								Create a key
							</button>
						</div>
					)}
					<CliLine label="Or terminal" command={CLI_LOGIN_COMMAND} />
				</>
			),
		},
		{
			title: "Read your first rows",
			body: "Straight from the chain, decoded.",
			done: false,
			current: false,
		},
	];
}

/** The sentence and sub-line over a new account with no key. */
export function OnboardingSentence() {
	return (
		<StatusSentence
			tone="idle"
			sub="The SDK, the CLI and plain HTTP calls all read with it. The first 1M rows each month are free, no card needed."
		>
			Make a key to start.
		</StatusSentence>
	);
}

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
	/** Which view to show; the normal page is `running`. */
	stage?: AccountStage;
	/** A new account's flow and first-rows guide. */
	onboarding?: OverviewOnboarding | null;
	/** Whether any subgraph exists. When none does, the start block stands in for the empty section. */
	hasSubgraphs?: boolean;
	/** The first read, once it lands while the page is open. */
	firstRead?: FirstRead | null;
	/** Back from Stripe: the top-up's outcome, shown at the top of the usage block. */
	topup?: ReturnState | null;
	/** The phone layout: the same blocks as rows and sheets, with no commands. */
	compact?: boolean;
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
	subgraphs,
	keys = null,
	apps = null,
	caps = null,
	now = new Date(),
	insights = [],
	asleep = false,
	stage = "running",
	onboarding = null,
	hasSubgraphs = true,
	firstRead = null,
	topup = null,
	loading = false,
	compact = false,
}: OverviewBodyProps) {
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

	if (compact) {
		return (
			<CompactOverviewBody
				{...{
					rows,
					billing,
					burn,
					stack,
					readUsage,
					subgraphs,
					keys,
					apps,
					caps,
					now,
					insights,
					stage,
					onboarding,
					hasSubgraphs,
					firstRead,
					topup,
					loading,
				}}
				creditsOut={creditsOut}
				failing={failing}
				accountState={accountState}
			/>
		);
	}

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

	const subgraphRows = subgraphs ?? <OverviewSubgraphsSlot />;
	const flow = onboarding?.flow ?? null;
	const usage = (
		<UsageBlock
			readUsage={readUsage}
			billing={billing}
			burn={burn}
			caps={caps}
			stopped={stack?.state === "stopped"}
			returnState={topup}
			now={now}
		/>
	);
	const keysBlock = <KeysBlock keys={keys} apps={apps} now={now} />;
	const topNote = (
		<TopNote insights={insights} failing={failing} state={accountState} />
	);

	if (stage === "no_key") {
		return (
			<div className="ov-page">
				<OnboardingSentence />
				{flow}
				<Checklist
					steps={noKeySteps({
						flowOpen: flow !== null,
						onCreateKey: () => onboarding?.onCreateKey(),
					})}
				/>
				<TerminalBlock login={false} />
			</div>
		);
	}

	if (stage === "no_reads") {
		return (
			<div className="ov-page">
				<PageHead />
				{flow}
				<section className="ov-section" aria-label="Read your first rows">
					<div className="ov-section-h">
						<h2>Read your first rows</h2>
					</div>
					<p className="ov-lede">
						{onboarding?.keyName ? (
							<>
								Your key <b>{onboarding.keyName}</b> is ready.
							</>
						) : (
							"Your key is ready."
						)}{" "}
						Nothing has read with it yet. This block goes away after the first
						read.
					</p>
					{onboarding?.firstRows}
				</section>
				<StartBlock />
				{usage}
				<TerminalBlock />
				{keysBlock}
			</div>
		);
	}

	if (stage === "reading") {
		return (
			<div className="ov-page">
				<PageHead />
				{flow}
				{firstRead ? (
					<output className="ov-lede">
						✓ First read at {clockTime(firstRead.at)} from{" "}
						<b>{firstRead.keyName}</b>.
					</output>
				) : null}
				{topNote}
				{usage}
				<StartBlock />
				<TerminalBlock />
				{keysBlock}
			</div>
		);
	}

	// Running. A section with nothing in it gives way to the start block, once.
	const webhooksEmpty = rows !== null && rows.length === 0;
	const start = <StartBlock />;

	return (
		<div className="ov-page">
			<PageHead />
			{flow}
			{topNote}

			{rows !== null && rows.length > 0 ? (
				<section id="webhooks" className="ov-section" aria-label="Webhooks">
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
			) : webhooksEmpty ? (
				start
			) : null}

			{hasSubgraphs ? (
				<section id="subgraphs" className="ov-section" aria-label="Subgraphs">
					<div className="ov-section-h">
						<h2>Subgraphs</h2>
					</div>
					<div className="dash-rows ov-table">{subgraphRows}</div>
					<CliLine label="Deploy one" command="sl subgraphs deploy --help" />
				</section>
			) : webhooksEmpty || rows === null ? null : (
				start
			)}

			{usage}
			<TerminalBlock />
			{keysBlock}
		</div>
	);
}

/** The blocks a link can point at with `/account#<id>`. */
const ANCHORS = ["webhooks", "subgraphs", "usage", "keys", "cap"];

/** Scroll to the block named by the URL hash, once, after the first paint of real data. */
function useScrollToHash(ready: boolean) {
	const done = useRef(false);
	useEffect(() => {
		if (!ready || done.current) return;
		done.current = true;
		const id = location.hash.slice(1);
		if (ANCHORS.includes(id)) {
			document.getElementById(id)?.scrollIntoView();
		}
	}, [ready]);
}

/** Stripe returns with `?topup=success|cancelled`. Reading it clears it, so
 *  guard against effects running twice. */
function useStripeReturn(): ReturnState | null {
	const [ret, setRet] = useState<TopupReturn | null>(null);
	const taken = useRef(false);
	useEffect(() => {
		if (taken.current) return;
		taken.current = true;
		setRet(takeTopupReturn());
	}, []);
	return useTopupReturn(ret);
}

/**
 * The new-account pieces for the Overview: which stage the page is in, the
 * name-a-key flow, and the first-rows guide. The flow opens from Create a key
 * and stays up through the key being made (the keys list changes under it)
 * until its Done, whatever stage the page moves to.
 */
function useOnboarding({
	keys,
	now,
	pushed,
	accountId,
	firstRowsCode,
	firstRowsPrompt,
}: {
	keys: ApiKey[] | null;
	now: Date;
	pushed: boolean;
	accountId: string | null;
	firstRowsCode?: ReactNode;
	firstRowsPrompt?: ReactNode;
}): { stage: AccountStage; onboarding: OverviewOnboarding } {
	const [flowOpen, setFlowOpen] = useState(false);
	const [made, setMade] = useState<string | null>(null);
	const [skipped, setSkipped] = useState(false);
	useEffect(() => {
		if (accountId) setSkipped(onboardingSkipped(accountId));
	}, [accountId]);

	const newest = countedKeys(keys, now).at(-1);
	return {
		stage: accountStage(keys, now, pushed, skipped),
		onboarding: {
			keyName: made ?? newest?.name ?? null,
			onCreateKey: () => setFlowOpen(true),
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
		},
	};
}

/** /account: is everything running, what needs you, what it costs. The
 *  first-rows blocks are server-rendered by the page and passed in. */
export function OverviewSection({
	firstRowsCode,
	firstRowsPrompt,
	compact = false,
}: {
	firstRowsCode?: ReactNode;
	firstRowsPrompt?: ReactNode;
	/** The phone layout. */
	compact?: boolean;
} = {}) {
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
	const hasSubgraphs = (subgraphs?.data.length ?? 0) > 0;
	const { stage, onboarding } = useOnboarding({
		keys,
		now,
		// An asleep stack never returns its webhook list, but it has webhooks.
		pushed: (rows?.length ?? 0) > 0 || hasSubgraphs || asleep,
		accountId: account?.id ?? null,
		firstRowsCode,
		firstRowsPrompt,
	});
	const firstRead = useFirstRead(stage, keys);

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

	useScrollToHash(ready);
	const topup = useStripeReturn();

	const body = (
		<OverviewBody
			compact={compact}
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
			stage={stage}
			onboarding={onboarding}
			hasSubgraphs={hasSubgraphs}
			firstRead={firstRead}
			topup={topup}
		/>
	);
	if (!compact) return body;
	return (
		<>
			<PullRefresh
				onRefresh={() =>
					Promise.all([
						refreshInsights(),
						refreshList(),
						refreshSummary(),
						refreshRows(),
						refreshBilling(),
						refreshCaps(),
						refreshKeys(),
						refreshUsage(month),
					])
				}
			/>
			{body}
		</>
	);
}
