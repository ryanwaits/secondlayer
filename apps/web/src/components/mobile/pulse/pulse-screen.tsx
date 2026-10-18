"use client";

import { rowsCell } from "@/components/account/overview/overview-view";
import { useSubgraphsPoll } from "@/components/account/subgraphs/list-screen";
import { ChartSkeleton } from "@/components/charts/chart-skeleton";
import { LazyBandBarChart } from "@/components/charts/lazy";
import {
	type Billing,
	type Caps,
	formatUsd,
	refreshBilling,
	refreshCaps,
	refreshRows,
	useAccountData,
} from "@/lib/account-data";
import { barsRows } from "@/lib/dashboard-charts";
import { SITE } from "@/lib/docs-agent";
import { type Insight, severityDot } from "@/lib/insights";
import { refreshInsights, useInsights } from "@/lib/insights-store";
import type { RowsResponse } from "@/lib/rows";
import { useSubgraphsCache } from "@/lib/subgraphs-store";
import { formatRows } from "@/lib/usage";
import type { WebhooksActivitySummary } from "@/lib/webhooks-data";
import {
	poll,
	refreshList,
	refreshSummary,
	useWebhooksCache,
} from "@/lib/webhooks-store";
import { type ReactNode, useEffect, useState } from "react";
import { InsightRow } from "../insights/insight-row";
import { useInsightSheets } from "../insights/insight-sheet-host";
import { readSeenAt } from "../insights/insights-screen";
import { isNewInsight } from "../insights/insights-view";
import { shareLink } from "../share/share-fix-sheet";
import {
	healthyLine,
	isNewAccount,
	last24,
	needsYou,
	spendLine,
	todayEvents,
	updatedLabel,
} from "./pulse-view";
import { usePullRefresh } from "./use-pull-refresh";

const POLL_MS = 30_000;
const DASH = "–";

function Section({ title, aside }: { title: string; aside?: ReactNode }) {
	return (
		<div className="m-pulse-sec">
			<b>{title}</b>
			{aside !== undefined ? <span>{aside}</span> : null}
		</div>
	);
}

function Line({ label, value }: { label: string; value: string }) {
	return (
		<div className="m-pulse-kv">
			<span>{label}</span>
			<span>{value}</span>
		</div>
	);
}

export type PulseBodyProps = {
	insights: readonly Insight[];
	/** Hourly delivered and failed for every webhook; undefined until it loads. */
	summary: WebhooksActivitySummary | undefined;
	rows: RowsResponse | null;
	billing: Billing | null;
	caps: Caps | null;
	webhookCount: number;
	subgraphCount: number;
	isNew: boolean;
	/** Insights and the webhook list have both loaded, so "All delivering" is true. */
	loaded: boolean;
	now: Date;
	/** Text after "Updated". */
	updated: string;
	/** Insights created after this (ms) show NEW. */
	seenAt: number;
	onOpen: (id: string) => void;
};

function NeedsYou({
	needs,
	seenAt,
	webhookCount,
	subgraphCount,
	loaded,
	onOpen,
}: {
	needs: readonly Insight[];
	loaded: boolean;
	seenAt: number;
	webhookCount: number;
	subgraphCount: number;
	onOpen: (id: string) => void;
}) {
	return (
		<>
			<Section title="Needs you" aside={needs.length || "nothing"} />
			<div className="m-pulse-group">
				{needs.length === 0 && !loaded ? (
					<div className="m-pulse-row">
						<ChartSkeleton height={36} />
					</div>
				) : needs.length === 0 ? (
					<div className="m-pulse-row">
						<span className="ins-dot" />
						<span className="m-pulse-text">
							<span className="m-pulse-lead">All delivering</span>
							<span className="m-pulse-meta">
								{healthyLine(webhookCount, subgraphCount)}
							</span>
						</span>
					</div>
				) : (
					needs.map((insight) => (
						<button
							key={insight.id}
							type="button"
							className="m-pulse-row is-button"
							onClick={() => onOpen(insight.id)}
						>
							<span className={`ins-dot ${severityDot(insight.severity)}`} />
							<span className="m-pulse-text">
								<span className="m-pulse-lead">
									{insight.lead}
									{isNewInsight(insight, seenAt) ? (
										<span className="m-ins-new">NEW</span>
									) : null}
								</span>
								{insight.meta ? (
									<span className="m-pulse-meta">{insight.meta}</span>
								) : null}
							</span>
							<svg
								className="m-pulse-chev"
								width="16"
								height="16"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="m6 3.5 4.5 4.5L6 12.5" />
							</svg>
						</button>
					))
				)}
			</div>
		</>
	);
}

function Last24({ summary }: { summary: WebhooksActivitySummary | undefined }) {
	const d = last24(summary);
	const failed = d.failed.reduce((a, b) => a + b, 0);
	return (
		<>
			<Section title="Last 24 hours" aside="all webhooks" />
			<div className="m-pulse-group m-pulse-chart">
				{summary ? (
					<>
						<div className="m-pulse-cap">
							<span className={failed > 0 ? "is-bad" : undefined}>
								{failed > 0
									? `${failed.toLocaleString("en-US")} failed`
									: "No failures"}
							</span>
						</div>
						<LazyBandBarChart
							rows={barsRows(
								d.delivered.map((n, i) => ({ n, f: d.failed[i] })),
							)}
							height={120}
							xLabels={[
								[0, "24h ago"],
								[Math.max(0, d.hours.length - 1), "now"],
							]}
							seriesNames={{ n: "Delivered", p: "", f: "Failed" }}
						/>
					</>
				) : (
					<ChartSkeleton height={120} />
				)}
			</div>
		</>
	);
}

/** The Pulse body from plain props, so the Lab and tests render it with no stores. */
export function PulseBody({
	insights,
	summary,
	rows,
	billing,
	caps,
	webhookCount,
	subgraphCount,
	isNew,
	loaded,
	now,
	updated,
	seenAt,
	onOpen,
}: PulseBodyProps) {
	const cell = rows ? rowsCell(rows, now) : null;
	const spend = spendLine(billing, caps);
	return (
		<div className="m-pulse">
			<p className="m-sub">Updated {updated}</p>
			{isNew ? (
				<>
					<Section title="Your stack" />
					<div className="m-pulse-empty">
						<b>Nothing running yet</b>
						<p>
							Create a webhook or subgraph from your desk. It shows up here,
							with its health, the moment it starts.
						</p>
						<button
							type="button"
							className="btn"
							onClick={() =>
								void shareLink("Set up Secondlayer", `${SITE}/account`)
							}
						>
							Send yourself the link
						</button>
					</div>
					<Section title="This month" />
					<div className="m-pulse-group">
						<Line
							label="Rows read"
							value={cell ? `${formatRows(cell.used)} of 1M free` : DASH}
						/>
						<Line
							label="Spend"
							value={
								billing ? formatUsd(billing.spentThisMonthUsdMicros) : DASH
							}
						/>
					</div>
				</>
			) : (
				<>
					<NeedsYou
						needs={needsYou(insights)}
						seenAt={seenAt}
						webhookCount={webhookCount}
						subgraphCount={subgraphCount}
						loaded={loaded}
						onOpen={onOpen}
					/>
					<Last24 summary={summary} />
					<Section title="Today" aside="since 00:00 UTC" />
					<div className="m-pulse-group">
						<Line
							label="Rows read"
							value={cell ? formatRows(cell.today) : DASH}
						/>
						<Line
							label="Webhook events"
							value={
								summary
									? todayEvents(summary, now).toLocaleString("en-US")
									: DASH
							}
						/>
						<Line label="Spend this month" value={spend ?? DASH} />
					</div>
				</>
			)}
		</div>
	);
}

/** The pull-to-refresh indicator above the body. */
function PullIndicator({ phase, offset }: ReturnType<typeof usePullRefresh>) {
	if (phase === "idle") return null;
	return (
		<output className="m-ptr" style={{ height: offset || undefined }}>
			{phase === "busy"
				? "Updating…"
				: phase === "ready"
					? "Release to refresh"
					: "Pull to refresh"}
		</output>
	);
}

/** The phone Pulse tab: what needs you, the last 24 hours, and today. */
export function PulseScreen() {
	const { billing, rows, caps } = useAccountData();
	const insights = useInsights();
	const cache = useWebhooksCache();
	const subgraphs = useSubgraphsCache().list;
	const [seenAt] = useState(readSeenAt);
	const [now, setNow] = useState(() => new Date());
	const { open, sheets } = useInsightSheets(insights.data);

	useEffect(() => {
		refreshBilling();
		refreshCaps();
	}, []);
	useEffect(
		() =>
			poll(async () => {
				await refreshRows();
				return {};
			}, 60_000),
		[],
	);
	useEffect(
		() =>
			poll(async () => {
				const [list] = await Promise.all([refreshList(), refreshSummary()]);
				return list.kind === "starting" || list.kind === "rate_limited"
					? { retryAfterMs: list.retryAfter * 1000 }
					: {};
			}, POLL_MS),
		[],
	);
	useSubgraphsPoll();

	// "Updated" ages on its own; tick so the label stays honest.
	useEffect(() => {
		const id = setInterval(() => setNow(new Date()), 10_000);
		return () => clearInterval(id);
	}, []);

	const pull = usePullRefresh(async () => {
		await Promise.all([
			refreshInsights(),
			refreshList(),
			refreshSummary(),
			refreshRows(),
			refreshBilling(),
			refreshCaps(),
		]);
		setNow(new Date());
	});

	const webhooks = cache.list?.data ?? null;
	const at = Math.max(insights.at, cache.list?.at ?? 0);
	return (
		<>
			<PullIndicator {...pull} />
			<PulseBody
				insights={insights.data}
				summary={cache.summary?.data}
				rows={rows}
				billing={billing}
				caps={caps}
				webhookCount={webhooks?.length ?? 0}
				subgraphCount={subgraphs?.data.length ?? 0}
				isNew={isNewAccount(webhooks, subgraphs?.data)}
				loaded={insights.status === "ok" && webhooks !== null}
				now={now}
				updated={at > 0 ? updatedLabel(at, now.getTime()) : DASH}
				seenAt={seenAt}
				onOpen={open}
			/>
			{sheets}
		</>
	);
}

/** Pulse over plain props with its insight sheets wired, for the Lab. */
export function LocalPulse(props: Omit<PulseBodyProps, "onOpen">) {
	const { open, sheets } = useInsightSheets(props.insights);
	return (
		<>
			<PulseBody {...props} onOpen={open} />
			{sheets}
		</>
	);
}
