"use client";

import { CopyButton } from "@/components/copy-button";
import { HeatStrip } from "@/components/dashboard/charts/heat-strip";
import { Legend } from "@/components/dashboard/charts/legend";
import {
	KeyFirstLine,
	PlaceholderRows,
} from "@/components/dashboard/shell/onboarding";
import { StatusSentence } from "@/components/dashboard/shell/status-sentence";
import { refreshKeys, useAccountData } from "@/lib/account-data";
import { hasNoKey } from "@/lib/onboarding";
import { hostOf } from "@/lib/webhooks-data";
import { poll, refreshList, refreshSummary } from "@/lib/webhooks-store";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ToneDot, type WebhookRowModel, useWebhookRows } from "./rows";
import { shortenName } from "./shared";
import { WebhooksListSkeleton } from "./skeletons";

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
					className="acct-btn solid"
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

function EmptyState({ noKey }: { noKey: boolean }) {
	return (
		<div className="wl-empty">
			<StatusSentence tone="idle">No webhooks yet.</StatusSentence>
			<p>
				A webhook posts chain events to your server the block they land. You
				create one with the SDK, so the filter lives in your code and your
				reviews.
			</p>
			{noKey ? <KeyFirstLine /> : null}
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
	/** The account has no key of its own yet. */
	noKey?: boolean;
}

export function WebhooksListBody({
	rows,
	hours,
	notice,
	onOpenHour,
	noKey = false,
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

			{rows === null && notice?.kind === "asleep" ? <AsleepNotice /> : null}

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

			{rows !== null && rows.length === 0 ? <EmptyState noKey={noKey} /> : null}

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
	const { keys } = useAccountData();
	useEffect(() => {
		refreshKeys();
	}, []);
	return (
		<WebhooksListBody
			noKey={hasNoKey(keys, new Date())}
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
