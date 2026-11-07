"use client";

import { AsleepState } from "@/components/account/asleep-state";
import { CopyButton } from "@/components/copy-button";
import {
	HeatStrip,
	HeatStripSkeleton,
} from "@/components/dashboard/charts/heat-strip";
import { HourRibbon } from "@/components/dashboard/charts/hour-ribbon";
import { ActionableInsights } from "@/components/dashboard/insight/insight-actions";
import { StatusSentence } from "@/components/dashboard/shell/status-sentence";
import { useCompact } from "@/components/mobile/use-compact";
import { getAgentPrompt } from "@/lib/agent-prompts";
import { heatGrid } from "@/lib/dashboard-charts";
import type { IndexView } from "@/lib/index-view";
import type { Insight } from "@/lib/insights";
import { forAccountRules, useInsights } from "@/lib/insights-store";
import type { WebhooksListInitial } from "@/lib/server/dashboard-reads";
import type { StackNotice } from "@/lib/stack-status";
import { usePollNotice } from "@/lib/use-stack";
import { hostOf } from "@/lib/webhooks-data";
import { listSeed, refreshList, refreshSummary } from "@/lib/webhooks-store";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CopyForAgent, EmptyStart, type Guide } from "../empty-start";
import {
	IndexList,
	RowName,
	RowShell,
	RowStats,
	RowWhy,
	WebhookRoute,
} from "../index-rows/index-list";
import {
	type RowStatus,
	WEBHOOK_GROUP_LABELS,
	webhookStatus,
	webhookWhyLine,
} from "../index-rows/status";
import { WebhooksCompactList } from "./compact-list";
import { changePause, pauseTargetOf } from "./pause-action";
import { type WebhookRowModel, useWebhookRows } from "./rows";
import { countByDisplayStatus, shortenName } from "./shared";
import { WebhooksListSkeleton } from "./skeletons";
import { ageShort } from "./view";
import { WaitingBlock } from "./waiting";

/** The list polls this often while the tab is visible, so new webhooks and
 *  status changes show up without a reload. */
const LIST_POLL_MS = 15_000;
const HOUR_MS = 3_600_000;

/** Polls the list and the hourly summary. A notice only appears while there
 *  are no cached rows to show: once rows have landed, a later starting, rate
 *  limit or error just keeps retrying behind them. A page that opened with the
 *  server's reads (`initial`) waits a full interval for the first poll, unless
 *  its list or summary didn't load. */
function useListPoll(initial: WebhooksListInitial | null): StackNotice | null {
	const listLoaded =
		initial?.list.kind === "ok" && initial.summary.kind === "ok";
	return usePollNotice({
		initial: initial?.list,
		run: async () => (await Promise.all([refreshList(), refreshSummary()]))[0],
		intervalMs: LIST_POLL_MS,
		immediate: !listLoaded,
	});
}

function Notice({
	tone,
	title,
	children,
	action,
}: {
	tone: "wait" | "stop";
	title: string;
	children: React.ReactNode;
	action?: React.ReactNode;
}) {
	return (
		<output className={`wh-notice ${tone}`}>
			<div>
				<p className="wh-notice-t">
					{tone === "wait" ? (
						<span className="wh-spin" aria-hidden="true" />
					) : null}
					{title}
				</p>
				<p className="wh-notice-l">{children}</p>
			</div>
			{action}
		</output>
	);
}

/** The create call from the webhooks guide: the filter lives in your code. */
const CREATE_EXAMPLE = `import { trigger } from "@secondlayer/sdk";

await sl.webhooks.create({
  name: "amm-swaps",
  url: "https://my-app.com/webhook",
  triggers: [
    trigger.contractCall({ contractId: "SP....amm", functionName: "swap-*" }),
    trigger.ftTransfer({ trait: "sip-010", minAmount: "1000000" }),
  ],
});`;

const WEBHOOK_GUIDES: readonly Guide[] = [
	{
		title: "Create a webhook",
		description: "Name, URL and triggers, from the SDK or the CLI.",
		href: "/docs/webhooks#create-a-webhook",
	},
	{
		title: "Triggers and limits",
		description: "Every event type and the filter fields each one takes.",
		href: "/docs/webhooks#triggers-and-limits",
	},
	{
		title: "Receive and verify",
		description: "Check the Standard Webhooks signature on your server.",
		href: "/docs/webhooks#receive-and-verify",
	},
	{
		title: "Replay and recovery",
		description: "Requeue dead letters and replay a block range.",
		href: "/docs/webhooks#replay-and-recovery",
	},
];

function EmptyState() {
	return (
		<EmptyStart
			guides={WEBHOOK_GUIDES}
			docsHref="/docs/webhooks"
			docsLabel="Webhooks docs"
		>
			<StatusSentence>No webhooks yet.</StatusSentence>
			<p>
				A webhook posts chain events to your server the block they land. You
				create one with the SDK, so the filter lives in your code and your
				reviews.
			</p>
			<div className="wh-cli nk-block">
				<code className="wh-cli-code">{CREATE_EXAMPLE}</code>
				<CopyButton code={CREATE_EXAMPLE} inline label="Copy" />
			</div>
			<CopyForAgent
				prompt={getAgentPrompt("webhook-create")}
				hint="Your agent asks what to listen for, then builds it with you."
			/>
		</EmptyStart>
	);
}

/** A webhook as the index shows it: its model plus what the row says about it. */
interface WebhookIndexRow {
	model: WebhookRowModel;
	status: RowStatus;
	why: string | null;
}

const indexRow = (model: WebhookRowModel): WebhookIndexRow => ({
	model,
	status: webhookStatus(model),
	why: webhookWhyLine(model),
});

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
const count = (n: number) => n.toLocaleString("en-US");

function WebhookListRow({
	row,
	hours,
	view,
	isLast,
	onOpenHour,
	stripPending,
}: {
	row: WebhookIndexRow;
	hours: readonly string[];
	view: IndexView;
	/** The last row carries the hour axis the others leave out. */
	isLast: boolean;
	onOpenHour: (id: string, hourIso: string) => void;
	/** The hourly summary hasn't landed: hold the strip's space. */
	stripPending: boolean;
}) {
	const {
		model: { webhook, series },
		status,
		why,
	} = row;
	const cells = series
		? series.delivered.map((n, i) => ({ n, f: series.failed[i] ?? 0 }))
		: [];
	const now = timelineNow(hours);
	const tone = status.group === "hi" ? "att" : undefined;
	const label = `${webhook.name}, deliveries per hour, last 7 days`;
	const delivered = series ? sum(series.delivered) : null;
	const failed = series ? sum(series.failed) : null;
	const name = (
		<RowName
			name={webhook.name}
			display={shortenName(webhook.name)}
			status={status}
		>
			{webhook.managedBy ? (
				<span
					className="wl-chip"
					title={`${webhook.managedBy} finds this webhook by its name, so rename it there`}
				>
					named by {webhook.managedBy}
				</span>
			) : null}
		</RowName>
	);
	const route = <WebhookRoute webhook={webhook} />;
	const whyLine = why ? <RowWhy text={why} group={status.group} /> : null;
	const href = `/account/webhooks/${webhook.id}`;
	const strip =
		cells.length > 0 && now !== null ? (
			view === "ribbon" ? (
				<HourRibbon hours={cells} now={now} label={label} tone={tone} />
			) : (
				<HeatStrip
					hours={cells}
					now={now}
					label={label}
					tone={tone}
					hourAxis={isLast}
					onCellClick={(index) => {
						const hour = hours[index];
						if (hour) onOpenHour(webhook.id, hour);
					}}
				/>
			)
		) : stripPending ? (
			view === "ribbon" ? (
				<div className="ix-strip pending" aria-hidden="true" />
			) : (
				<HeatStripSkeleton days={pendingStripDays()} hourAxis={isLast} />
			)
		) : (
			<div />
		);

	if (view === "ribbon") {
		return (
			<RowShell
				href={href}
				main={
					<>
						{name}
						{whyLine ?? route}
					</>
				}
			>
				{strip}
				<span className="ix-num">
					{delivered === null ? "–" : count(delivered)}
					{failed ? <small>{count(failed)} failed</small> : null}
				</span>
				<span className="ix-ago">{ageShort(webhook.lastDeliveryAt)}</span>
			</RowShell>
		);
	}
	return (
		<RowShell
			href={href}
			main={
				<>
					{name}
					{whyLine}
					{route}
					<RowStats
						stats={[
							{
								value: delivered === null ? "–" : count(delivered),
								label: "delivered, 7 days",
							},
							{
								value: failed === null ? "–" : count(failed),
								label: "failed",
								alarm: !!failed,
							},
							{
								value: ageShort(webhook.lastDeliveryAt),
								label: "since the last",
							},
						]}
					/>
				</>
			}
		>
			<div>{strip}</div>
		</RowShell>
	);
}

/** Midpoint of the newest hour: keeps it on its own row at midnight. */
function timelineNow(hours: readonly string[]): number | null {
	const last = hours.at(-1);
	return last ? Date.parse(last) + HOUR_MS / 2 : null;
}

/** Rows only render on the client once data arrives, so the clock is safe. */
function pendingStripDays(): number {
	return heatGrid([], Math.floor(Date.now() / HOUR_MS) * HOUR_MS + HOUR_MS / 2)
		.days.length;
}

export interface WebhooksListBodyProps {
	/** Null until the first list has loaded. */
	rows: WebhookRowModel[] | null;
	hours: readonly string[];
	notice: StackNotice | null;
	onOpenHour: (id: string, hourIso: string) => void;
	/** The hourly summary has loaded. Defaults to true. */
	summaryLoaded?: boolean;
	/** Account-level insights about this page (the stack not answering). */
	pageInsights?: readonly Insight[];
	/** The view the visitor left this page in. Defaults to Rows. */
	initialView?: IndexView;
}

export function WebhooksListBody({
	rows,
	hours,
	notice,
	onOpenHour,
	summaryLoaded = true,
	pageInsights = [],
	initialView = "rows",
}: WebhooksListBodyProps) {
	const active = rows?.filter((r) => r.webhook.lastDeliveryAt !== null) ?? [];
	const quiet = rows?.filter((r) => r.webhook.lastDeliveryAt === null) ?? [];
	return (
		<>
			<div className="wl-head">
				<h1>Webhooks</h1>
				<p>
					Chain events to your server. You create them with the SDK and change
					them with <code>sl webhooks</code>.
				</p>
			</div>

			<ActionableInsights insights={pageInsights} />

			{rows === null && notice === null ? <WebhooksListSkeleton /> : null}

			{rows === null && notice?.kind === "starting" ? (
				<Notice tone="wait" title="Starting your hosted stack">
					Your account gets its own hosted stack the first time you use
					webhooks. This takes about 30 seconds.
				</Notice>
			) : null}

			{rows === null && notice?.kind === "asleep" ? <AsleepState /> : null}

			{rows === null && notice?.kind === "no_credits" ? (
				<Notice
					tone="stop"
					title="Deliveries are paused until you add credits"
					action={
						<a className="acct-btn solid small" href="/account/credits">
							Add credits
						</a>
					}
				>
					Your webhooks and settings are kept, and nothing is skipped: delivery
					resumes where it stopped.
				</Notice>
			) : null}

			{rows === null && notice?.kind === "error" ? (
				<p className="acct-error">{notice.message}</p>
			) : null}

			{rows !== null && rows.length === 0 ? <EmptyState /> : null}

			{rows !== null && rows.length > 0 ? (
				<>
					{active.length > 0 ? (
						<IndexList
							page="webhooks"
							noun="webhooks"
							singular="webhook"
							rows={active.map(indexRow)}
							rowKey={(row) => row.model.webhook.id}
							textOf={({ model: { webhook } }) =>
								`${webhook.name} ${webhook.kind} ${hostOf(webhook.url)}`
							}
							groupOf={(row) => row.status.group}
							groupLabels={WEBHOOK_GROUP_LABELS}
							failedLabel="Failed"
							numberLabel="7 days"
							now={timelineNow(hours)}
							initialView={initialView}
							renderRow={(row, { view, isLast }) => (
								<WebhookListRow
									row={row}
									hours={hours}
									view={view}
									isLast={isLast}
									onOpenHour={onOpenHour}
									stripPending={!summaryLoaded}
								/>
							)}
						/>
					) : null}
					{quiet.length > 0 ? (
						<WaitingBlock webhooks={quiet.map((m) => m.webhook)} />
					) : null}
				</>
			) : null}
		</>
	);
}

/** /account/webhooks. `initial` is what the server read for this visit. */
export function WebhooksListSection({
	initial = null,
	initialView,
}: {
	initial?: WebhooksListInitial | null;
	initialView?: IndexView;
}) {
	const router = useRouter();
	const notice = useListPoll(initial);
	const { rows, hours, summaryLoaded } = useWebhookRows(
		initial ? listSeed(initial) : undefined,
	);
	// Only the list defines the layout, so rows paint when it lands. The strip
	// holds its space with HeatStripSkeleton and the state line says
	// "Counting…", so nothing moves when the summary or insights arrive.
	const { data: insights } = useInsights();
	const compact = useCompact();
	const [busyId, setBusyId] = useState<string | null>(null);

	async function onTogglePause(row: WebhookRowModel) {
		const { id, name } = row.webhook;
		setBusyId(id);
		await changePause(id, name, pauseTargetOf(row.webhook));
		setBusyId(null);
	}

	if (compact) {
		if (rows === null && notice?.kind === "asleep") return <AsleepState />;
		if (rows === null && notice?.kind === "no_credits") {
			return (
				<Notice tone="stop" title="Deliveries are paused until you add credits">
					Your webhooks are kept; delivery resumes where it stopped.
				</Notice>
			);
		}
		if (rows === null && notice?.kind === "error") {
			return <p className="acct-error">{notice.message}</p>;
		}
		return (
			<WebhooksCompactList
				rows={rows}
				failing={
					rows
						? countByDisplayStatus(
								rows.map((r) => r.webhook),
								"error",
							)
						: 0
				}
				busyId={busyId}
				onOpen={(id) => router.push(`/account/webhooks/${id}`)}
				onTogglePause={onTogglePause}
			/>
		);
	}
	return (
		<WebhooksListBody
			pageInsights={forAccountRules(insights, ["stack_unreachable_webhooks"])}
			rows={rows}
			hours={hours}
			summaryLoaded={summaryLoaded}
			notice={notice}
			initialView={initialView}
			onOpenHour={(id, hourIso) =>
				router.push(
					`/account/webhooks/${id}?hour=${encodeURIComponent(hourIso)}`,
				)
			}
		/>
	);
}
