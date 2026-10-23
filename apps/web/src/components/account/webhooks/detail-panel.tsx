"use client";

import { Choice } from "@/components/choice";
import { Breadcrumb } from "@/components/dashboard/shell/breadcrumb";
import { NameMark } from "@/components/dashboard/shell/name-mark";
import { NameTip } from "@/components/dashboard/shell/name-tip";
import { useCompact } from "@/components/mobile/use-compact";
import { formatDate } from "@/lib/account-data";
import { type Insight, rankInsights } from "@/lib/insights";
import { forResource, useInsights } from "@/lib/insights-store";
import { isFresh } from "@/lib/request-cache";
import {
	type WebhookActivityDay,
	hostOf,
	pauseWebhook,
	renameWebhook,
	resumeWebhook,
	testWebhook,
} from "@/lib/webhooks-data";
import {
	applyWebhook,
	poll,
	refreshActivity,
	refreshDeliveriesWindow,
	refreshDetail,
	useWebhooksCache,
	webhooksSnapshot,
} from "@/lib/webhooks-store";
import type {
	DeliveryRow,
	WebhookActivity,
	WebhookDetail,
	WebhookTestResult,
} from "@secondlayer/sdk";
import Link from "next/link";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AsleepState } from "./asleep-state";
import { AttemptTimeline } from "./attempt-timeline";
import { WebhookCompactDetail } from "./compact-detail";
import { DefinitionDrawer } from "./definition-drawer";
import { DeliveriesChart } from "./deliveries-chart";
import { describeTrigger } from "./describe-trigger";
import { PayloadView, answeredAttempt } from "./payload-view";
import { CliLine, displayStatus, formatEventCell, shortenName } from "./shared";
import { WebhookDetailSkeleton } from "./skeletons";
import { useRecovery } from "./use-recovery";
import {
	type Range,
	deliveryStats,
	describeFailure,
	groupAttempts,
	hourWindow,
	isOk,
	outageStartIndex,
	utcStamp,
} from "./view";
import { type TestState, WhatsHappening } from "./whats-happening";

/** How often the detail bundle (webhook, deliveries, activity)
 *  refreshes together while the tab is visible. */
const DETAIL_POLL_MS = 10_000;
/** The fast standalone `/activity` poll while events are waiting to send. */
const ACTIVITY_POLL_MS = 5_000;
/** Daily counts barely move; an hour window refreshes a little sooner. */
const DAYS_FRESH_MS = 5 * 60_000;
const WINDOW_FRESH_MS = 60_000;
const VISIBLE_GROUPS = 10;

/** The desktop page charts the last day or the last week; 48h and 30d are gone. */
const DESKTOP_RANGES: readonly Range[] = ["24h", "7d"];
const RANGE_OPTIONS = DESKTOP_RANGES.map((value) => ({ value, label: value }));

type DetailNotice =
	| { kind: "starting" }
	| { kind: "asleep" }
	| { kind: "no_credits" }
	| { kind: "not_found" }
	| { kind: "error"; message: string };

/**
 * Fires the whole detail bundle in parallel on mount, then again every
 * `DETAIL_POLL_MS` while the tab is visible. A non-ok webhook result becomes
 * this page's notice only when nothing is cached yet for it; once a webhook
 * has loaded, later failures keep retrying behind the last-known page.
 * `not_found` always wins, since a deleted webhook shouldn't keep showing.
 * `asleep` tracks the stack whether or not a page is cached, since cached
 * rows can't open a payload on an asleep stack.
 */
function useDetailPoll(
	id: string,
	fastActivityRef: { current: boolean },
): { notice: DetailNotice | null; asleep: boolean } {
	const [notice, setNotice] = useState<DetailNotice | null>(null);
	const [asleep, setAsleep] = useState(false);

	useEffect(() => {
		setNotice(null);
		setAsleep(false);
		return poll(async () => {
			const res = await refreshDetail(id, {
				activity: !fastActivityRef.current,
			});
			const hasCached = webhooksSnapshot().detail[id] !== undefined;
			const webhook = res.webhook;
			setAsleep(webhook.kind === "asleep");
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
			if (webhook.kind === "no_credits" || webhook.kind === "asleep") {
				if (!hasCached) setNotice({ kind: webhook.kind });
				return {};
			}
			if (!hasCached) setNotice({ kind: "error", message: webhook.message });
			return {};
		}, DETAIL_POLL_MS);
	}, [id, fastActivityRef]);

	return { notice, asleep };
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
	onOpenDetails,
}: {
	name: string;
	tone: Tone;
	managedBy: string | null;
	/** Resolves true when the new name was saved. */
	onRename: (name: string) => Promise<boolean>;
	/** Opens the definition drawer. */
	onOpenDetails: () => void;
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
					<NameTip tip="Click for details" onOpen={onOpenDetails}>
						<NameMark tone={tone}>
							<span className="wd-name" title={name}>
								{shortenName(saving ? draft.trim() : name)}
							</span>
						</NameMark>
					</NameTip>
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
	webhook: Pick<WebhookDetail, "createdAt">;
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
	const lastDay = activity?.hours.slice(-24) ?? null;
	return (
		<div className="wd-facts">
			{fact(
				"Sent · 24h",
				lastDay
					? sumOf(lastDay.map((h) => h.delivered)).toLocaleString("en-US")
					: "–",
			)}
			{fact(
				"Gave up · 24h",
				lastDay
					? sumOf(lastDay.map((h) => h.gaveUp)).toLocaleString("en-US")
					: "–",
			)}
			{fact(
				"p50 / p95",
				stats.p50 === null || stats.p95 === null
					? "–"
					: `${stats.p50.toLocaleString("en-US")} / ${stats.p95.toLocaleString("en-US")} ms`,
			)}
			{fact("Created", formatDate(webhook.createdAt))}
		</div>
	);
}

/** "swap-helper calls → hooks.example.dev": what it listens for, then where it goes. */
function leadLine(webhook: WebhookDetail): string {
	const { triggers } = webhook;
	const first = triggers[0];
	const host = hostOf(webhook.url);
	if (!first) return host;
	const sentence = describeTrigger(first, 0, triggers)
		.line.map((piece) => piece.text)
		.join("");
	const more = triggers.length > 1 ? ` · +${triggers.length - 1} more` : "";
	return `${sentence}${more} → ${host}`;
}

// ── Deliveries ───────────────────────────────────────────────────────────

function DeliveriesPanel({
	webhook,
	rows,
	hour,
	onClearHour,
	asleep,
}: {
	webhook: Pick<WebhookDetail, "id" | "url" | "triggers">;
	/** Null while the hour's window is still loading. */
	rows: readonly DeliveryRow[] | null;
	hour: { label: string } | null;
	onClearHour: () => void;
	asleep: boolean;
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
					<tbody aria-busy={rows === null}>
						{rows === null ? (
							<>
								{Array.from({ length: 5 }).map((_, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
									<tr key={i}>
										<td colSpan={5}>
											<span
												className="wh-skel"
												aria-hidden="true"
												style={{ display: "block", height: 14 }}
											/>
										</td>
									</tr>
								))}
							</>
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
								webhook={webhook}
								asleep={asleep}
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
	webhook,
	asleep,
	open,
	onToggle,
}: {
	attempts: DeliveryRow[];
	latest: DeliveryRow;
	webhook: Pick<WebhookDetail, "id" | "url" | "triggers">;
	asleep: boolean;
	open: boolean;
	onToggle: () => void;
}) {
	const answered = answeredAttempt(attempts);
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
						<PayloadView
							webhookId={webhook.id}
							deliveryId={latest.id}
							asleep={asleep}
							triggers={webhook.triggers}
							responseBody={answered.responseBody ?? null}
							statusCode={answered.statusCode}
							responseIsLatest={answered.id === latest.id}
							host={hostOf(webhook.url)}
						/>
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
	/** The last poll found the hosted stack asleep. */
	stackAsleep: boolean;
	onTest: () => void;
	test: TestState;
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
	stackAsleep,
	onTest,
	test,
}: WebhookDetailBodyProps) {
	const ranked = rankInsights(insights);
	const topInsight = ranked[0];
	const recovery = useRecovery(webhook.id);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const paused = webhook.status === "paused";
	// Only an all-paused stack sleeps; a resume wakes it, so the flag drops
	// the moment the webhook reads active again instead of on the next poll.
	const asleep = stackAsleep && paused;
	const quiet = deliveries.length === 0 && !hour;
	return (
		<>
			<Breadcrumb
				parent={{ href: "/account#webhooks", label: "Account" }}
				current={shortenName(webhook.name)}
				title={webhook.name}
			/>
			<header className="wd-head">
				<div className="wd-top">
					<TitleRow
						name={webhook.name}
						tone={toneFor(webhook, ranked)}
						managedBy={webhook.managedBy}
						onRename={onRename}
						onOpenDetails={() => setDrawerOpen(true)}
					/>
					<div className="wd-actions">
						<button
							type="button"
							className={paused ? "wd-btn nudge" : "wd-btn"}
							onClick={onTogglePause}
							disabled={pauseBusy}
						>
							{paused ? "Resume" : "Pause"}
						</button>
					</div>
				</div>
				<p className="wd-lead">{leadLine(webhook)}</p>
				<Facts webhook={webhook} activity={activity} deliveries={deliveries} />
			</header>

			{topInsight ? (
				<WhatsHappening
					insight={topInsight}
					recovery={recovery}
					onTest={onTest}
					test={test}
				/>
			) : null}

			{activity && !quiet ? (
				<div className="wd-chart">
					<div className="wd-chart-range">
						<Choice
							name="wd-range"
							size="sm"
							legend="Range"
							options={RANGE_OPTIONS}
							value={range}
							onChange={(value) => onRange(value as Range)}
						/>
					</div>
					<DeliveriesChart
						activity={activity}
						days={days}
						range={range}
						losing={ranked.some((i) => i.severity === "losing")}
					/>
				</div>
			) : null}

			<div className="wd-stack">
				{quiet ? (
					<p className="wd-faint">
						No deliveries yet. This webhook delivers on the first matching event
						on chain.
					</p>
				) : (
					<DeliveriesPanel
						webhook={webhook}
						rows={hour ? hourDeliveries : deliveries}
						hour={hour}
						onClearHour={onClearHour}
						asleep={asleep}
					/>
				)}
				<section className="wd-replay" aria-label="Replay">
					<span className="dash-label">Replay</span>
					<CliLine command={`sl webhooks replay ${webhook.name} --help`} />
				</section>
			</div>
			<DefinitionDrawer
				webhook={webhook}
				activity={activity}
				open={drawerOpen}
				onClose={() => setDrawerOpen(false)}
			/>
		</>
	);
}

export function WebhookDetailSection({ id }: { id: string }) {
	const router = useRouter();
	const pathname = usePathname();
	const search = useSearchParams();
	const cache = useWebhooksCache();
	const fastActivity = useRef(false);
	const { notice, asleep: stackAsleep } = useDetailPoll(id, fastActivity);

	const webhook = cache.detail[id]?.data ?? null;
	const deliveries = cache.deliveries[id]?.data ?? null;
	const activity = cache.activity[id]?.data ?? null;
	const listSummary = cache.list?.data.find((w) => w.id === id) ?? null;

	const insights = forResource(useInsights().data, "webhook", id);
	const outage = activity ? outageStartIndex(activity.hours) : null;
	const [pickedRange, setPickedRange] = useState<Range | null>(null);
	// A page that opens on an outage starts on the day view that shows it.
	const range: Range = pickedRange ?? (outage === null ? "7d" : "24h");

	const [pauseBusy, setPauseBusy] = useState(false);
	const compact = useCompact();
	const [test, setTest] = useState<{
		busy: boolean;
		result: WebhookTestResult | null;
	}>({ busy: false, result: null });

	fastActivity.current = (activity?.waiting ?? 0) > 0;
	useEffect(() => {
		return poll(async () => {
			if (fastActivity.current) await refreshActivity(id);
			return {};
		}, ACTIVITY_POLL_MS);
	}, [id]);

	const hour = hourWindow(search.get("hour"));
	const hourFrom = hour?.from;
	const hourTo = hour?.to;
	useEffect(() => {
		if (!hourFrom || !hourTo) return;
		const cached = webhooksSnapshot().deliveriesWindow[`${id}:${hourFrom}`];
		if (cached && isFresh(`webhooks:window:${id}:${hourFrom}`, WINDOW_FRESH_MS))
			return;
		void refreshDeliveriesWindow(id, { from: hourFrom, to: hourTo });
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
				<Link href="/account#webhooks">Webhooks</Link>.
			</p>
		);
	}

	if (!webhook || !deliveries) {
		if (!webhook && notice?.kind === "asleep") return <AsleepState />;
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
					<a className="acct-btn solid small" href="/account#usage">
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
							parent={{ href: "/account#webhooks", label: "Account" }}
							current={shortenName(name)}
							title={name}
						/>
						<div className="wd-title">
							<h1>
								<span className="wd-name" title={name}>
									{shortenName(name)}
								</span>
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

	async function onTest() {
		setTest({ busy: true, result: null });
		const res = await testWebhook(id);
		if (res.kind === "ok") {
			setTest({ busy: false, result: res.data });
			if (res.data.ok) {
				toast.success(
					`Test got ${res.data.statusCode} in ${res.data.durationMs} ms`,
				);
			} else {
				toast.error("The test failed", {
					description: res.data.error ?? `HTTP ${res.data.statusCode}`,
				});
			}
			return;
		}
		setTest({ busy: false, result: null });
		toast.error("Couldn't send a test", { description: describeFailure(res) });
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

	if (compact) {
		return (
			<WebhookCompactDetail
				webhook={webhook}
				activity={activity}
				deliveries={deliveries}
				insights={insights}
				stackAsleep={stackAsleep}
				pauseBusy={pauseBusy}
				onTogglePause={onTogglePause}
				test={test}
				onTest={onTest}
			/>
		);
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
			stackAsleep={stackAsleep}
			onTest={onTest}
			test={test}
		/>
	);
}
