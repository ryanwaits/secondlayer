"use client";

import { HeatStrip } from "@/components/dashboard/charts/heat-strip";
import { Legend } from "@/components/dashboard/charts/legend";
import { hostOf } from "@/lib/webhooks-data";
import { poll, refreshList, refreshSummary } from "@/lib/webhooks-store";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ToneDot, type WebhookRowModel, useWebhookRows } from "./rows";
import { CliLine } from "./shared";
import { WebhooksListSkeleton } from "./skeletons";

/** The list polls this often while the tab is visible, so new webhooks and
 *  status changes show up without a reload. */
const LIST_POLL_MS = 15_000;
const HOUR_MS = 3_600_000;

type ListNotice =
	| { kind: "starting" }
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
			if (res.kind === "no_credits") {
				setNotice({ kind: "no_credits" });
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

function EmptyState() {
	return (
		<div className="wl-empty">
			<p>
				No webhooks yet. You create one with the SDK, and it starts delivering
				from the next block.
			</p>
			<p>
				<Link href="/docs/webhooks" className="dash-link">
					Webhooks in the docs ›
				</Link>
			</p>
			<CliLine command="sl webhooks list" />
		</div>
	);
}

function WebhookListRow({
	model,
	hours,
	onOpenHour,
}: {
	model: WebhookRowModel;
	hours: readonly string[];
	onOpenHour: (id: string, hourIso: string) => void;
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
					<span title={webhook.name}>{webhook.name}</span>
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
			) : null}
		</div>
	);
}

export interface WebhooksListBodyProps {
	/** Null until the first list has loaded. */
	rows: WebhookRowModel[] | null;
	hours: readonly string[];
	notice: ListNotice | null;
	onOpenHour: (id: string, hourIso: string) => void;
}

export function WebhooksListBody({
	rows,
	hours,
	notice,
	onOpenHour,
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

			{rows === null && notice === null ? <WebhooksListSkeleton /> : null}

			{rows === null && notice?.kind === "starting" ? (
				<Notice tone="wait" title="Starting your hosted stack">
					Your account gets its own hosted stack the first time you use
					webhooks. This takes about 30 seconds.
				</Notice>
			) : null}

			{rows === null && notice?.kind === "no_credits" ? (
				<Notice
					tone="stop"
					title="Deliveries are paused until you add credits"
					action={
						<a className="acct-btn solid" href="/account/credits">
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
							/>
						))}
						{quiet.length > 0 ? (
							<div className="wl-quiet">
								<span className="dash-row-name">
									<span className="dash-dot idle" />
									<span>{quiet.length} waiting for a first match</span>
								</span>
								<span className="wl-state">
									{quiet
										.map((m) => m.webhook.name.replace(/^sentinel:/, ""))
										.join(" · ")}
								</span>
							</div>
						) : null}
					</div>
					{active.length > 0 ? (
						<Legend
							items={[
								{
									swatch: "square",
									label: "Delivered in that hour (darker = more)",
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
				</>
			) : null}
		</>
	);
}

export function WebhooksListSection() {
	const router = useRouter();
	const notice = useListPoll();
	const { rows, hours } = useWebhookRows();
	return (
		<WebhooksListBody
			rows={rows}
			hours={hours}
			notice={notice}
			onOpenHour={(id, hourIso) =>
				router.push(
					`/account/webhooks/${id}?hour=${encodeURIComponent(hourIso)}`,
				)
			}
		/>
	);
}
