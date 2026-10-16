"use client";

import { LazyBandBarChart } from "@/components/charts/lazy";
import { Choice } from "@/components/choice";
import { Legend } from "@/components/dashboard/charts/legend";
import { ActionableInsights } from "@/components/dashboard/insight/insight-actions";
import { Breadcrumb } from "@/components/dashboard/shell/breadcrumb";
import { dotClass } from "@/components/dashboard/shell/status-sentence";
import { formatDate } from "@/lib/account-data";
import { barsRows } from "@/lib/dashboard-charts";
import { type Insight, rankInsights } from "@/lib/insights";
import { forResource, useInsights } from "@/lib/insights-store";
import {
	type WebhookActivityDay,
	hostOf,
	pauseWebhook,
	renameWebhook,
	resumeWebhook,
} from "@/lib/webhooks-data";
import type { WebhooksResult } from "@/lib/webhooks-data";
import {
	applyWebhook,
	poll,
	refreshActivity,
	refreshDays,
	refreshDeliveriesWindow,
	refreshDetail,
	useWebhooksCache,
	webhooksSnapshot,
} from "@/lib/webhooks-store";
import type {
	DeliveryRow,
	WebhookActivity,
	WebhookDetail,
} from "@secondlayer/sdk";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AttemptTimeline } from "./attempt-timeline";
import { displayStatus, formatEventCell } from "./shared";
import { WebhookDetailSkeleton } from "./skeletons";
import { TriggersBox } from "./triggers";
import {
	RANGES,
	type Range,
	deliveryStats,
	groupAttempts,
	hourWindow,
	isOk,
	outageStartIndex,
	rangeBars,
	utcClock,
	utcStamp,
} from "./view";

/** How often the detail bundle (webhook, deliveries, dead, activity)
 *  refreshes together while the tab is visible. */
const DETAIL_POLL_MS = 10_000;
/** The fast standalone `/activity` poll while events are waiting to send. */
const ACTIVITY_POLL_MS = 5_000;
const VISIBLE_GROUPS = 10;

const RANGE_OPTIONS = RANGES.map((value) => ({ value, label: value }));

/** A one-line, user-facing reason for anything short of `{ kind: "ok" }`. */
function describeFailure(
	res: Exclude<WebhooksResult<unknown>, { kind: "ok" }>,
): string {
	if (res.kind === "rate_limited") {
		return `Too many requests. Try again in ${res.retryAfter}s.`;
	}
	if (res.kind === "starting") return "Your hosted stack is still starting.";
	if (res.kind === "no_credits") return "Add credits to do that.";
	if (res.kind === "not_found") return "That webhook wasn't found.";
	return res.message;
}

type DetailNotice =
	| { kind: "starting" }
	| { kind: "no_credits" }
	| { kind: "not_found" }
	| { kind: "error"; message: string };

/**
 * Fires the whole detail bundle in parallel on mount, then again every
 * `DETAIL_POLL_MS` while the tab is visible. A non-ok webhook result becomes
 * this page's notice only when nothing is cached yet for it; once a webhook
 * has loaded, later failures keep retrying behind the last-known page.
 * `not_found` always wins, since a deleted webhook shouldn't keep showing.
 */
function useDetailPoll(
	id: string,
	fastActivityRef: { current: boolean },
): DetailNotice | null {
	const [notice, setNotice] = useState<DetailNotice | null>(null);

	useEffect(() => {
		setNotice(null);
		return poll(async () => {
			const res = await refreshDetail(id, {
				activity: !fastActivityRef.current,
			});
			const hasCached = webhooksSnapshot().detail[id] !== undefined;
			const webhook = res.webhook;
			if (webhook.kind === "ok") {
				setNotice(null);
				return {};
			}
			if (webhook.kind === "not_found") {
				setNotice({ kind: "not_found" });
				return {};
			}
			if (webhook.kind === "rate_limited") {
				return { retryAfterMs: webhook.retryAfter * 1000 };
			}
			if (webhook.kind === "starting") {
				if (!hasCached) setNotice({ kind: "starting" });
				return { retryAfterMs: webhook.retryAfter * 1000 };
			}
			if (webhook.kind === "no_credits") {
				if (!hasCached) setNotice({ kind: "no_credits" });
				return {};
			}
			if (!hasCached) setNotice({ kind: "error", message: webhook.message });
			return {};
		}, DETAIL_POLL_MS);
	}, [id, fastActivityRef]);

	return notice;
}

// ── Title row ────────────────────────────────────────────────────────────

type Tone = "ok" | "alarm" | "hi" | "idle";

function toneFor(webhook: WebhookDetail, insights: readonly Insight[]): Tone {
	const status = displayStatus(webhook);
	if (status === "paused") return "idle";
	if (status === "error" || insights.some((i) => i.severity === "losing")) {
		return "alarm";
	}
	if (insights.some((i) => i.severity === "will_fail")) return "hi";
	return "ok";
}

export function TitleRow({
	name,
	tone,
	managedBy,
	onRename,
}: {
	name: string;
	tone: Tone;
	managedBy: string | null;
	/** Resolves true when the new name was saved. */
	onRename: (name: string) => Promise<boolean>;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(name);
	const [saving, setSaving] = useState(false);
	// Enter and Escape unmount the input, which can also fire blur; this keeps
	// that blur from saving a second time (or saving a cancelled edit).
	const skipBlur = useRef(false);

	const start = () => {
		skipBlur.current = false;
		setDraft(name);
		setEditing(true);
	};
	const cancel = () => {
		skipBlur.current = true;
		setEditing(false);
	};
	const save = async () => {
		const next = draft.trim();
		setEditing(false);
		if (!next || next === name) return;
		setSaving(true);
		await onRename(next);
		setSaving(false);
	};

	return (
		<div className="wd-title">
			<h1>
				<span className={dotClass(tone)} />
				{editing ? (
					<input
						className="wd-rename-input"
						value={draft}
						maxLength={128}
						aria-label="Webhook name"
						spellCheck={false}
						autoFocus
						onChange={(event) => setDraft(event.target.value)}
						onFocus={(event) => event.currentTarget.select()}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								skipBlur.current = true;
								void save();
							} else if (event.key === "Escape") {
								event.preventDefault();
								cancel();
							}
						}}
						onBlur={() => {
							if (skipBlur.current) {
								skipBlur.current = false;
								return;
							}
							void save();
						}}
					/>
				) : (
					<span className="wd-name">{saving ? draft.trim() : name}</span>
				)}
				{managedBy ? (
					<span
						className="wd-chip-own"
						title={`${managedBy} finds this webhook by its name, so rename it there`}
					>
						named by {managedBy}
					</span>
				) : editing ? null : (
					<button type="button" className="wd-rename" onClick={start}>
						Rename
					</button>
				)}
			</h1>
			{editing ? (
				<span className="wd-rename-hint">
					Enter to save, Esc to cancel. Only the label changes: the ID, filter
					and deliveries stay. Scripts that use the old name need the new one.
				</span>
			) : null}
		</div>
	);
}

// ── Facts ────────────────────────────────────────────────────────────────

const sumOf = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

function Facts({
	webhook,
	activity,
	deliveries,
}: {
	webhook: WebhookDetail;
	activity: WebhookActivity | null;
	deliveries: readonly DeliveryRow[];
}) {
	const stats = deliveryStats(deliveries);
	const fact = (label: string, value: string) => (
		<div key={label}>
			{label}
			<b>{value}</b>
		</div>
	);
	return (
		<div className="wd-facts">
			{fact(
				"Delivered · 7d",
				activity
					? sumOf(activity.hours.map((h) => h.delivered)).toLocaleString(
							"en-US",
						)
					: "–",
			)}
			{fact(
				"Gave up · 7d",
				activity
					? sumOf(activity.hours.map((h) => h.gaveUp)).toLocaleString("en-US")
					: "–",
			)}
			{fact("Retried · last 100", stats.retried.toLocaleString("en-US"))}
			{fact(
				"p50 / p95 · last 100",
				stats.p50 === null || stats.p95 === null
					? "–"
					: `${stats.p50.toLocaleString("en-US")} / ${stats.p95.toLocaleString("en-US")} ms`,
			)}
			{fact("Receiver", hostOf(webhook.url))}
			{fact("Created", formatDate(webhook.createdAt))}
		</div>
	);
}

// ── Chart ────────────────────────────────────────────────────────────────

const BAND_NOTE =
	'No "usual range" band: under 1 event an hour is too little to call anything unusual. The band shows up once there\'s enough volume.';

function DeliveriesChart({
	activity,
	days,
	range,
	losing,
}: {
	activity: WebhookActivity;
	days: readonly WebhookActivityDay[] | undefined;
	range: Range;
	/** A losing insight is on the page, so mark where the outage began. */
	losing: boolean;
}) {
	const bars = rangeBars(range, activity, days);
	const hourly = range !== "30d";
	const outage = losing ? outageStartIndex(activity.hours) : null;
	const outageHour = outage === null ? undefined : activity.hours[outage]?.hour;
	const markIndex = outage === null ? -1 : outage - bars.offset;
	const mark =
		hourly && outageHour && markIndex >= 0
			? { index: markIndex, label: `Failures start ${utcClock(outageHour)}` }
			: undefined;
	const showBandNote = range !== "7d" && hourly && !activity.usualByHourOfDay;
	return (
		<section className="dash-panel" aria-label="Deliveries">
			<div className="dash-panel-h">
				<span className="dash-label">
					Deliveries per {hourly ? "hour" : "day"}
				</span>
				<Legend
					items={[
						{
							swatch: "square",
							label: "Delivered",
							color: "var(--ch-a)",
						},
						{ swatch: "square", label: "Failed" },
						...(bars.band
							? [{ swatch: "band" as const, label: "Usual for this hour" }]
							: []),
					]}
				/>
			</div>
			{bars.rows.length === 0 ? (
				<p className="wd-faint">Loading the last 30 days…</p>
			) : (
				<LazyBandBarChart
					rows={barsRows(bars.rows, { band: bars.band ?? undefined })}
					height={180}
					xLabels={bars.labels}
					mark={mark}
					seriesNames={{ n: "Delivered", p: "", f: "Failed" }}
				/>
					pointLabels={bars.pointLabels}
			)}
			{showBandNote ? <span className="wd-faint">{BAND_NOTE}</span> : null}
		</section>
	);
}

// ── Deliveries ───────────────────────────────────────────────────────────

function DeliveriesPanel({
	rows,
	hour,
	onClearHour,
}: {
	/** Null while the hour's window is still loading. */
	rows: readonly DeliveryRow[] | null;
	hour: { label: string } | null;
	onClearHour: () => void;
}) {
	const [open, setOpen] = useState<string | null>(null);
	const [showAll, setShowAll] = useState(false);
	const groups = groupAttempts(rows ?? []);
	const shown = showAll ? groups : groups.slice(0, VISIBLE_GROUPS);
	return (
		<section className="dash-panel" id="wd-deliveries" aria-label="Deliveries">
			<div className="dash-panel-h">
				<span className="wd-panel-title">
					<span className="dash-label">
						{hour ? "Deliveries" : "Recent deliveries"}
					</span>
					{hour ? (
						<button
							type="button"
							className="wd-fchip"
							aria-label={`Clear filter ${hour.label}`}
							onClick={onClearHour}
						>
							{hour.label} <i>×</i>
						</button>
					) : null}
				</span>
				<span className="wd-faint">click a row for its attempts</span>
			</div>
			<div className="wd-tbl-wrap">
				<table className="wd-tbl">
					<thead>
						<tr>
							<th>Time (UTC)</th>
							<th>Event</th>
							<th>Status</th>
							<th>Attempts</th>
							<th className="r">ms</th>
						</tr>
					</thead>
					<tbody>
						{rows === null ? (
							<tr>
								<td colSpan={5} className="wd-faint wd-empty">
									Loading…
								</td>
							</tr>
						) : groups.length === 0 ? (
							<tr>
								<td colSpan={5} className="wd-faint wd-empty">
									{hour
										? "No deliveries kept for this hour. Deliveries are kept 30 days."
										: "No deliveries yet."}
								</td>
							</tr>
						) : null}
						{shown.map(({ key, attempts, latest }) => (
							<DeliveryRowView
								key={key}
								attempts={attempts}
								latest={latest}
								open={open === key}
								onToggle={() => setOpen(open === key ? null : key)}
							/>
						))}
					</tbody>
				</table>
			</div>
			{groups.length > VISIBLE_GROUPS ? (
				<button
					type="button"
					className="wd-more"
					onClick={() => setShowAll((v) => !v)}
				>
					{showAll ? "Show fewer" : `Show all ${groups.length}`}
				</button>
			) : null}
		</section>
	);
}

function DeliveryRowView({
	attempts,
	latest,
	open,
	onToggle,
}: {
	attempts: DeliveryRow[];
	latest: DeliveryRow;
	open: boolean;
	onToggle: () => void;
}) {
	return (
		<>
			<tr
				className="click"
				tabIndex={0}
				aria-expanded={open}
				onClick={onToggle}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onToggle();
					}
				}}
			>
				<td>{utcStamp(latest.dispatchedAt)}</td>
				<td>{formatEventCell(latest.txId, latest.eventIndex)}</td>
				<td className={isOk(latest) ? "good" : "bad"}>
					{latest.statusCode ?? "none"}
				</td>
				<td>
					<span
						className="wd-att"
						role="img"
						aria-label={`${attempts.length} ${attempts.length === 1 ? "attempt" : "attempts"}`}
					>
						{attempts.map((a) => (
							<i key={a.id} className={isOk(a) ? "" : "f"} />
						))}
					</span>
				</td>
				<td className="r">
					{latest.durationMs === null
						? "–"
						: latest.durationMs.toLocaleString("en-US")}
				</td>
			</tr>
			{open ? (
				<tr className="exp">
					<td colSpan={5}>
						<AttemptTimeline attempts={attempts} />
					</td>
				</tr>
			) : null}
		</>
	);
}

// ── The page ─────────────────────────────────────────────────────────────

export interface WebhookDetailBodyProps {
	webhook: WebhookDetail;
	deliveries: DeliveryRow[];
	activity: WebhookActivity | null;
	days: WebhookActivityDay[] | undefined;
	insights: Insight[];
	range: Range;
	onRange: (range: Range) => void;
	/** The hour a heat square opened, when `?hour=` is set. */
	hour: { label: string } | null;
	/** Deliveries inside that hour; null while loading. */
	hourDeliveries: DeliveryRow[] | null;
	onClearHour: () => void;
	pauseBusy: boolean;
	onTogglePause: () => void;
	onRename: (name: string) => Promise<boolean>;
}

export function WebhookDetailBody({
	webhook,
	deliveries,
	activity,
	days,
	insights,
	range,
	onRange,
	hour,
	hourDeliveries,
	onClearHour,
	pauseBusy,
	onTogglePause,
	onRename,
}: WebhookDetailBodyProps) {
	const ranked = rankInsights(insights);
	const quiet = deliveries.length === 0 && !hour;
	return (
		<>
			<Breadcrumb
				parent={{ href: "/account/webhooks", label: "Webhooks" }}
				current={webhook.name}
			/>
			<header className="wd-head">
				<div className="wd-top">
					<TitleRow
						name={webhook.name}
						tone={toneFor(webhook, ranked)}
						managedBy={webhook.managedBy}
						onRename={onRename}
					/>
					<div className="wd-actions">
						<Choice
							name="wd-range"
							size="sm"
							legend="Range"
							options={RANGE_OPTIONS}
							value={range}
							onChange={(value) => onRange(value as Range)}
						/>
						<button
							type="button"
							className="wd-btn"
							onClick={onTogglePause}
							disabled={pauseBusy}
						>
							{webhook.status === "paused" ? "Resume" : "Pause"}
						</button>
					</div>
				</div>
				<Facts webhook={webhook} activity={activity} deliveries={deliveries} />
			</header>

			<ActionableInsights insights={ranked} />

			{activity && !quiet ? (
				<DeliveriesChart
					activity={activity}
					days={days}
					range={range}
					losing={ranked.some((i) => i.severity === "losing")}
				/>
			) : null}

			<div className="wd-two">
				<section className="dash-panel" aria-label="Listens for">
					<span className="dash-label">Listens for</span>
					<TriggersBox triggers={webhook.triggers} activity={activity} />
					<span className="wd-faint">
						Defined in code. Filters can't change in place: create a new webhook
						with the SDK, then delete this one.
					</span>
				</section>
				{quiet ? (
					<p className="wd-faint">
						No deliveries yet. This webhook delivers on the first matching event
						on chain.
					</p>
				) : (
					<DeliveriesPanel
						rows={hour ? hourDeliveries : deliveries}
						hour={hour}
						onClearHour={onClearHour}
					/>
				)}
			</div>
		</>
	);
}

export function WebhookDetailSection({ id }: { id: string }) {
	const router = useRouter();
	const pathname = usePathname();
	const search = useSearchParams();
	const cache = useWebhooksCache();
	const fastActivity = useRef(false);
	const notice = useDetailPoll(id, fastActivity);

	const webhook = cache.detail[id]?.data ?? null;
	const deliveries = cache.deliveries[id]?.data ?? null;
	const activity = cache.activity[id]?.data ?? null;
	const listSummary = cache.list?.data.find((w) => w.id === id) ?? null;

	const insights = forResource(useInsights().data, "webhook", id);
	const outage = activity ? outageStartIndex(activity.hours) : null;
	const [pickedRange, setPickedRange] = useState<Range | null>(null);
	// A page that opens on an outage starts on the 48h view that shows it.
	const range: Range = pickedRange ?? (outage === null ? "7d" : "48h");

	const [pauseBusy, setPauseBusy] = useState(false);

	fastActivity.current = (activity?.waiting ?? 0) > 0;
	useEffect(() => {
		return poll(async () => {
			if (fastActivity.current) await refreshActivity(id);
			return {};
		}, ACTIVITY_POLL_MS);
	}, [id]);

	useEffect(() => {
		if (range === "30d") void refreshDays(id);
	}, [id, range]);

	const hour = hourWindow(search.get("hour"));
	const hourFrom = hour?.from;
	const hourTo = hour?.to;
	useEffect(() => {
		if (hourFrom && hourTo) {
			void refreshDeliveriesWindow(id, { from: hourFrom, to: hourTo });
		}
	}, [id, hourFrom, hourTo]);
	const hourDeliveries = hourFrom
		? (cache.deliveriesWindow[`${id}:${hourFrom}`]?.data ?? null)
		: null;

	// Bring the deliveries into view once, when the page opens on an hour.
	const scrolledTo = useRef<string | null>(null);
	useEffect(() => {
		if (!hourFrom || hourDeliveries === null) return;
		if (scrolledTo.current === hourFrom) return;
		scrolledTo.current = hourFrom;
		document.getElementById("wd-deliveries")?.scrollIntoView({
			block: "start",
			behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
				? "auto"
				: "smooth",
		});
	}, [hourFrom, hourDeliveries]);

	if (notice?.kind === "not_found") {
		return (
			<p className="acct-muted">
				That webhook doesn't exist, or belongs to a different account. Back to{" "}
				<Link href="/account/webhooks">Webhooks</Link>.
			</p>
		);
	}

	if (!webhook || !deliveries) {
		if (!webhook && notice?.kind === "no_credits") {
			return (
				<output className="wh-notice stop">
					<div>
						<p className="wh-notice-t">
							Deliveries are paused until you add credits
						</p>
						<p className="wh-notice-l">
							This webhook and its settings are kept; delivery resumes where it
							stopped.
						</p>
					</div>
					<a className="acct-btn solid" href="/account/credits">
						Add credits
					</a>
				</output>
			);
		}
		if (!webhook && notice?.kind === "starting") {
			return (
				<output className="wh-notice wait">
					<div>
						<p className="wh-notice-t">
							<span className="wh-spin" aria-hidden="true" />
							Starting your hosted stack
						</p>
						<p className="wh-notice-l">
							This takes about 30 seconds. Hang tight.
						</p>
					</div>
				</output>
			);
		}
		if (!webhook && notice?.kind === "error") {
			return <p className="acct-error">{notice.message}</p>;
		}
		const name = webhook?.name ?? listSummary?.name;
		return (
			<>
				{name ? (
					<>
						<Breadcrumb
							parent={{ href: "/account/webhooks", label: "Webhooks" }}
							current={name}
						/>
						<div className="wd-title">
							<h1>
								<span className="wd-name">{name}</span>
							</h1>
						</div>
					</>
				) : null}
				<WebhookDetailSkeleton hideHead={name !== undefined} />
			</>
		);
	}

	async function onTogglePause() {
		const resuming = webhook?.status === "paused";
		setPauseBusy(true);
		const res = resuming ? await resumeWebhook(id) : await pauseWebhook(id);
		setPauseBusy(false);
		if (res.kind === "ok") {
			applyWebhook(res.data);
			toast.success(resuming ? "Webhook resumed" : "Webhook paused");
			return;
		}
		toast.error("Couldn't change this webhook", {
			description: describeFailure(res),
		});
	}

	async function onRename(name: string): Promise<boolean> {
		const res = await renameWebhook(id, name);
		if (res.kind === "ok") {
			applyWebhook(res.data);
			toast.success("Webhook renamed");
			return true;
		}
		toast.error("Couldn't rename this webhook", {
			description: describeFailure(res),
		});
		return false;
	}

	return (
		<WebhookDetailBody
			webhook={webhook}
			deliveries={deliveries}
			activity={activity}
			days={cache.days[id]?.data}
			insights={insights}
			range={range}
			onRange={setPickedRange}
			hour={hour}
			hourDeliveries={hourDeliveries}
			onClearHour={() => router.replace(pathname, { scroll: false })}
			pauseBusy={pauseBusy}
			onTogglePause={onTogglePause}
			onRename={onRename}
		/>
	);
}
