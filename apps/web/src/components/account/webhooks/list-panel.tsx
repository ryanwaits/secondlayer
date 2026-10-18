"use client";

import { CopyButton } from "@/components/copy-button";
import {
	HeatStrip,
	HeatStripSkeleton,
} from "@/components/dashboard/charts/heat-strip";
import { Legend } from "@/components/dashboard/charts/legend";
import { ActionableInsights } from "@/components/dashboard/insight/insight-actions";
import { PlaceholderRows } from "@/components/dashboard/shell/onboarding";
import { StatusSentence } from "@/components/dashboard/shell/status-sentence";
import { useCompact } from "@/components/mobile/use-compact";
import { heatGrid } from "@/lib/dashboard-charts";
import type { Insight } from "@/lib/insights";
import { forAccountRules, useInsights } from "@/lib/insights-store";
import { useFirstSettle } from "@/lib/use-first-settle";
import { hostOf, pauseWebhook, resumeWebhook } from "@/lib/webhooks-data";
import {
	applyWebhook,
	poll,
	refreshList,
	refreshSummary,
} from "@/lib/webhooks-store";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { WebhooksCompactList } from "./compact-list";
import { ToneDot, type WebhookRowModel, useWebhookRows } from "./rows";
import { countByDisplayStatus, displayStatus, shortenName } from "./shared";
import { WebhooksListSkeleton } from "./skeletons";
import { describeFailure } from "./view";
import { WaitingBlock } from "./waiting";

/** The list polls this often while the tab is visible, so new webhooks and
 *  status changes show up without a reload. */
const LIST_POLL_MS = 15_000;
const HOUR_MS = 3_600_000;

type ListNotice =
	| { kind: "starting" }
	| { kind: "asleep" }
	| { kind: "no_credits" }
	| { kind: "error"; message: string };

/** Polls the list and the hourly summary. A notice only appears while there
 *  are no cached rows to show: once rows have landed, a later starting, rate
 *  limit or error just keeps retrying behind them. */
function useListPoll(): ListNotice | null {
	const [notice, setNotice] = useState<ListNotice | null>(null);
	useEffect(() => {
		return poll(async () => {
			const [res] = await Promise.all([refreshList(), refreshSummary()]);
			if (res.kind === "ok") {
				setNotice(null);
				return {};
			}
			if (res.kind === "starting") {
				setNotice({ kind: "starting" });
				return { retryAfterMs: res.retryAfter * 1000 };
			}
			if (res.kind === "rate_limited") {
				return { retryAfterMs: res.retryAfter * 1000 };
			}
			if (res.kind === "no_credits" || res.kind === "asleep") {
				setNotice({ kind: res.kind });
				return {};
			}
			setNotice({ kind: "error", message: res.message });
			return {};
		}, LIST_POLL_MS);
	}, []);
	return notice;
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

/** Every webhook is paused, so the stack stopped and stops billing. Waking
 *  it is the user's call: the next list poll then shows it starting. */
export function AsleepNotice() {
	const [waking, setWaking] = useState(false);
	return (
		<Notice
			tone="stop"
			title="Your hosted stack is asleep"
			action={
				<button
					type="button"
					className="acct-btn solid small"
					disabled={waking}
					onClick={() => {
						setWaking(true);
						void refreshList({ wake: true });
					}}
				>
					{waking ? "Waking…" : "Wake it"}
				</button>
			}
		>
			Every webhook is paused, so the stack stopped and isn't billed. Wake it to
			see your webhooks and resume one. It takes about 30 seconds.
		</Notice>
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

function EmptyState() {
	return (
		<div className="wl-empty">
			<StatusSentence tone="idle">No webhooks yet.</StatusSentence>
			<p>
				A webhook posts chain events to your server the block they land. You
				create one with the SDK, so the filter lives in your code and your
				reviews.
			</p>
			<div className="wh-cli nk-block">
				<code className="wh-cli-code">{CREATE_EXAMPLE}</code>
				<CopyButton code={CREATE_EXAMPLE} inline label="Copy" />
			</div>
			<p>
				<Link href="/docs/webhooks" className="dash-link">
					Webhooks guide ›
				</Link>
			</p>
			<PlaceholderRows
				rows={[
					{ state: 66, count: 40 },
					{ state: 52, count: 48 },
				]}
			/>
		</div>
	);
}

function WebhookListRow({
	model,
	hours,
	onOpenHour,
	stripPending,
}: {
	model: WebhookRowModel;
	hours: readonly string[];
	onOpenHour: (id: string, hourIso: string) => void;
	/** The hourly summary hasn't landed: hold the strip's space. */
	stripPending: boolean;
}) {
	const { webhook, series, state } = model;
	const cells = series
		? series.delivered.map((n, i) => ({ n, f: series.failed[i] ?? 0 }))
		: [];
	const last = hours.at(-1);
	return (
		<div className="wl-row">
			<Link href={`/account/webhooks/${webhook.id}`} className="wl-main">
				<span className="dash-row-name">
					<ToneDot tone={state.tone} />
					<span title={webhook.name}>{shortenName(webhook.name)}</span>
					{webhook.managedBy ? (
						<span
							className="wl-chip"
							title={`${webhook.managedBy} finds this webhook by its name, so rename it there`}
						>
							named by {webhook.managedBy}
						</span>
					) : null}
				</span>
				<span className={`wl-state${state.bad ? " bad" : ""}`}>
					{state.text}
				</span>
				<span className="wl-sub">
					{webhook.kind} events → <b>{hostOf(webhook.url)}</b>
				</span>
			</Link>
			{cells.length > 0 && last ? (
				<HeatStrip
					hours={cells}
					// Mid-hour keeps the newest hour on its own row at midnight.
					now={Date.parse(last) + HOUR_MS / 2}
					label={`${webhook.name}, deliveries per hour, last 7 days`}
					onCellClick={(index) => {
						const hour = hours[index];
						if (hour) onOpenHour(webhook.id, hour);
					}}
				/>
			) : stripPending ? (
				<HeatStripSkeleton days={pendingStripDays()} />
			) : null}
		</div>
	);
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
	notice: ListNotice | null;
	onOpenHour: (id: string, hourIso: string) => void;
	/** The hourly summary has loaded. Defaults to true. */
	summaryLoaded?: boolean;
	/** Account-level insights about this page (the stack not answering). */
	pageInsights?: readonly Insight[];
}

export function WebhooksListBody({
	rows,
	hours,
	notice,
	onOpenHour,
	summaryLoaded = true,
	pageInsights = [],
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

			{rows === null && notice?.kind === "asleep" ? <AsleepNotice /> : null}

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
					<div className="wl-rows">
						{active.map((model) => (
							<WebhookListRow
								key={model.webhook.id}
								model={model}
								hours={hours}
								onOpenHour={onOpenHour}
								stripPending={!summaryLoaded}
							/>
						))}
					</div>
					{active.length > 0 ? (
						<Legend
							items={[
								{
									swatch: "square",
									label: "Delivered that hour, darker is more",
									color: "var(--ch-a)",
								},
								{ swatch: "square", label: "Failed" },
								{
									swatch: "square",
									label: "Nothing",
									color: "var(--soft)",
								},
							]}
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

export function WebhooksListSection() {
	const router = useRouter();
	const notice = useListPoll();
	const { rows, hours, summaryLoaded } = useWebhookRows();
	// Only the list defines the layout, so rows paint when it lands, at most
	// FIRST_SETTLE_MS late. The strip holds its space with HeatStripSkeleton and
	// the state line says "Counting…", so nothing moves when the summary or
	// insights arrive.
	const ready = useFirstSettle(rows !== null);
	const { data: insights } = useInsights();
	const compact = useCompact();
	const [busyId, setBusyId] = useState<string | null>(null);

	async function onTogglePause(row: WebhookRowModel) {
		const { id, name } = row.webhook;
		const resuming = displayStatus(row.webhook) !== "active";
		setBusyId(id);
		const res = resuming ? await resumeWebhook(id) : await pauseWebhook(id);
		setBusyId(null);
		if (res.kind !== "ok") {
			toast.error("Couldn't change this webhook", {
				description: describeFailure(res),
			});
			return;
		}
		applyWebhook(res.data);
		const label = shortenName(name);
		if (resuming) {
			toast.success(`Resumed ${label}`);
			return;
		}
		toast(`Paused ${label}. Events wait for you.`, {
			duration: 5000,
			action: {
				label: "Undo",
				onClick: () => {
					void resumeWebhook(id).then((undone) => {
						if (undone.kind === "ok") applyWebhook(undone.data);
					});
				},
			},
		});
	}

	if (compact) {
		if (rows === null && notice?.kind === "asleep") return <AsleepNotice />;
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
				rows={ready ? rows : null}
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
			rows={ready ? rows : null}
			hours={hours}
			summaryLoaded={summaryLoaded}
			notice={notice}
			onOpenHour={(id, hourIso) =>
				router.push(
					`/account/webhooks/${id}?hour=${encodeURIComponent(hourIso)}`,
				)
			}
		/>
	);
}
