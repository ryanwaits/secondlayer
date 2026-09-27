"use client";

import { formatDate } from "@/lib/account-data";
import {
	activityHeaderSummary,
	catchUpCopy,
	catchUpState,
} from "@/lib/webhook-graphs";
import {
	deleteWebhook,
	formatRelative,
	pauseWebhook,
	requeue,
	resumeWebhook,
	rotateSecret,
	testWebhook,
} from "@/lib/webhooks-data";
import type { WebhooksResult } from "@/lib/webhooks-data";
import {
	poll,
	refreshActivity,
	refreshDetail,
	useWebhooksCache,
	webhooksSnapshot,
} from "@/lib/webhooks-store";
import NumberFlow from "@number-flow/react";
import type { DeadRow, DeliveryRow, WebhookFormat } from "@secondlayer/sdk";
import {
	buildDoctorReport,
	isSuccessDelivery,
} from "@secondlayer/sdk/webhooks/doctor";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LazyMonoStackedBarChart } from "./charts/lazy";
import { DeliveryCard } from "./delivery-card";
import { DiagnosisPanel } from "./diagnosis";
import { AttemptRibbon } from "./ribbon";
import { CliLine, FiresOn, StatusPill, displayStatus } from "./shared";
import { WebhookDetailSkeleton } from "./skeletons";

/** How often the detail bundle (webhook, deliveries, dead, activity)
 *  refreshes together while the tab is visible — plan 073. */
const DETAIL_POLL_MS = 10_000;
/** The fast standalone `/activity` poll while a receiver is down or events
 *  are backed up — otherwise activity just rides the slower bundle above. */
const ACTIVITY_POLL_MS = 5_000;

/** A one-line, user-facing reason for anything short of `{ kind: "ok" }` —
 *  shared by every action's error path and its matching toast, so the two
 *  never say different things. */
function describeFailure(
	res: Exclude<WebhooksResult<unknown>, { kind: "ok" }>,
): string {
	if (res.kind === "rate_limited") {
		return `Too many requests — try again in ${res.retryAfter}s.`;
	}
	if (res.kind === "starting")
		return "Your delivery service is still starting.";
	if (res.kind === "no_credits") return "Add credits to do that.";
	if (res.kind === "not_found") return "That webhook wasn't found.";
	return res.message;
}

const FORMAT_LABEL: Record<WebhookFormat, string> = {
	"standard-webhooks": "Standard Webhooks, signed with your secret",
	inngest: "Inngest event",
	trigger: "Trigger.dev event",
	cloudflare: "Cloudflare Queues message",
	cloudevents: "CloudEvents envelope",
	raw: "Raw JSON payload",
};

/** Response time, oldest → newest, over the deliveries the page already
 *  fetched — moved here (from the deleted `chart.tsx`) since only the
 *  "Median response" stat still needs it. */
function medianOkDurationMs(rows: DeliveryRow[]): number {
	const durations = rows
		.filter(isSuccessDelivery)
		.map((r) => r.durationMs ?? 0)
		.sort((a, b) => a - b);
	if (durations.length === 0) return 0;
	return durations[Math.floor(durations.length / 2)] ?? 0;
}

type DetailNotice =
	| { kind: "starting" }
	| { kind: "no_credits" }
	| { kind: "not_found" }
	| { kind: "error"; message: string };

/**
 * Fires the whole detail bundle (webhook, deliveries, dead, activity) in
 * parallel through `refreshDetail` on mount, then again every
 * `DETAIL_POLL_MS` while the tab is visible — none of the four waits on the
 * webhook object first.
 *
 * A non-ok webhook result becomes this page's notice only when nothing is
 * cached yet for it; once a webhook has loaded once, a later starting/
 * no-credits/error result just keeps retrying quietly behind the
 * last-known page (stale-while-revalidate). `not_found` is the one
 * exception — it always wins, since a genuinely deleted webhook shouldn't
 * keep showing stale content.
 */
function useWebhookDetailPoll(
	id: string,
	skipActivityRef: { current: boolean },
): {
	notice: DetailNotice | null;
	reload: () => void;
} {
	const [notice, setNotice] = useState<DetailNotice | null>(null);

	useEffect(() => {
		setNotice(null);
		return poll(async () => {
			// While the fast activity-only poll below is doing the work, this
			// bundle skips that one read — otherwise both intervals fetch
			// `/activity` on the same tick.
			const res = await refreshDetail(id, {
				activity: !skipActivityRef.current,
			});
			const hasCached = webhooksSnapshot().detail[id] !== undefined;
			if (res.webhook.kind === "ok") {
				setNotice(null);
				return {};
			}
			if (res.webhook.kind === "not_found") {
				setNotice({ kind: "not_found" });
				return {};
			}
			if (res.webhook.kind === "starting") {
				if (!hasCached) setNotice({ kind: "starting" });
				return { retryAfterMs: res.webhook.retryAfter * 1000 };
			}
			if (res.webhook.kind === "rate_limited") {
				return { retryAfterMs: res.webhook.retryAfter * 1000 };
			}
			if (res.webhook.kind === "no_credits") {
				if (!hasCached) setNotice({ kind: "no_credits" });
				return {};
			}
			if (!hasCached) {
				setNotice({ kind: "error", message: res.webhook.message });
			}
			return {};
		}, DETAIL_POLL_MS);
		// `skipActivityRef` is a stable ref object from the caller — listed for
		// the linter, but its `.current` mutations never need to restart this
		// effect (the poll tick reads it fresh on every call).
	}, [id, skipActivityRef]);

	return { notice, reload: () => void refreshDetail(id) };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One `/activity` poll, kept client-side for the session — the catch-up
 *  bar's rate and the `receiver_down` graph's live line both read this. */
interface WaitingPoll {
	t: number;
	waiting: number;
}

const WAITING_HISTORY_LIMIT = 180; // ~15 minutes at the 5s poll cadence

export function WebhookDetailSection({ id }: { id: string }) {
	const router = useRouter();
	const cache = useWebhooksCache();
	// Shared with the fast activity poll below: true while that poll is the
	// one actually fetching activity, so the 10s bundle above can skip it.
	// Set for real once `activity`/`primary` are known further down; reading
	// it inside a poll tick always sees this render's latest value.
	const pollActiveRef = useRef(false);
	const { notice, reload } = useWebhookDetailPoll(id, pollActiveRef);

	const webhook = cache.detail[id]?.data ?? null;
	const deliveries = cache.deliveries[id]?.data ?? null;
	const dead = cache.dead[id]?.data ?? null;
	const activityEntry = cache.activity[id];
	const activity = activityEntry?.data ?? null;
	// The header (name, status, id) the list page already fetched — shown at
	// once while this page's own `GET /:id` is still in flight.
	const listSummary = cache.list?.data.find((w) => w.id === id) ?? null;

	const [tab, setTab] = useState<"deliveries" | "failed">("deliveries");

	const [waitingHistory, setWaitingHistory] = useState<WaitingPoll[]>([]);
	const [peakWaiting, setPeakWaiting] = useState(0);
	const sawNoCreditsRef = useRef(false);
	// The last activity fetch already folded into `waitingHistory` — an
	// `at` timestamp, not the data itself, since a poll can legitimately
	// repeat the same waiting count.
	const lastActivityAtRef = useRef<number | null>(null);

	const [showAllDeliveries, setShowAllDeliveries] = useState(false);
	const [openDeliveryId, setOpenDeliveryId] = useState<string | null>(null);

	const [testBusy, setTestBusy] = useState(false);
	const [testResult, setTestResult] = useState<{
		ok: boolean;
		text: string;
	} | null>(null);
	const [pauseBusy, setPauseBusy] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);

	const [rotating, setRotating] = useState<"idle" | "confirm" | "revealed">(
		"idle",
	);
	const [rotateBusy, setRotateBusy] = useState(false);
	const [newSecret, setNewSecret] = useState<string | null>(null);
	const [copiedSecret, setCopiedSecret] = useState(false);

	const [deleting, setDeleting] = useState(false);
	const [deleteName, setDeleteName] = useState("");
	const [deleteBusy, setDeleteBusy] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	const [resend, setResend] = useState<{ done: number; total: number } | null>(
		null,
	);
	const resendStop = useRef(false);
	// Rows requeued locally, hidden immediately instead of waiting out the
	// next poll — the cache itself is only ever written by a fetch.
	const [locallyResent, setLocallyResent] = useState<ReadonlySet<string>>(
		new Set(),
	);

	useEffect(() => {
		if (!activityEntry) return;
		if (lastActivityAtRef.current === activityEntry.at) return;
		lastActivityAtRef.current = activityEntry.at;
		const data = activityEntry.data;
		setPeakWaiting((prev) => Math.max(prev, data.waiting));
		setWaitingHistory((prev) =>
			[...prev, { t: activityEntry.at, waiting: data.waiting }].slice(
				-WAITING_HISTORY_LIMIT,
			),
		);
	}, [activityEntry]);

	useEffect(() => {
		if (notice?.kind === "no_credits") sawNoCreditsRef.current = true;
	}, [notice]);

	const rows = deliveries ?? [];
	const deadRows = (dead ?? []).filter((r) => !locallyResent.has(r.id));
	// `subgraph: null` — the dashboard never fetches subgraph status, so the
	// two subgraph issue codes (subgraph_gaps/subgraph_catching_up) never fire
	// here; the CLI passes the real subgraph status and can see them.
	// Gated on deliveries *and* dead having loaded at least once (they can be
	// cached from an earlier visit) — otherwise an empty `rows`/`deadRows`
	// reads as "no deliveries yet" before the real logs ever arrive.
	const report =
		webhook && deliveries !== null && dead !== null
			? buildDoctorReport({
					webhook,
					deliveries: rows,
					dead: deadRows,
					subgraph: null,
				})
			: null;
	const primary = report?.primary ?? null;

	// Kept current every render so the polling effects (which must stay
	// mounted for the page's whole life, not restart on every state change)
	// always see this render's answer to "should the fast poll be running".
	pollActiveRef.current =
		activity !== null && activity.waiting > 0
			? true
			: primary?.code === "receiver_down";

	// The fast standalone poll: only actually calls out while catching up or
	// down. Otherwise it just idles — activity still refreshes every
	// `DETAIL_POLL_MS` as part of the bundle above.
	useEffect(() => {
		return poll(async () => {
			if (!pollActiveRef.current) return {};
			await refreshActivity(id);
			return {};
		}, ACTIVITY_POLL_MS);
	}, [id]);

	const lastTwoPolls = waitingHistory.slice(-2);
	const isCatchingUp =
		activity !== null &&
		activity.waiting >= 100 &&
		lastTwoPolls.length === 2 &&
		(lastTwoPolls[1]?.waiting ?? 0) < (lastTwoPolls[0]?.waiting ?? 0);

	if (notice?.kind === "not_found") {
		return (
			<p className="acct-muted">
				That webhook doesn't exist, or belongs to a different account. Back to{" "}
				<Link href="/account/webhooks">Webhooks</Link>.
			</p>
		);
	}

	if (!webhook) {
		if (notice?.kind === "no_credits") {
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

		if (notice?.kind === "starting") {
			return (
				<output className="wh-notice wait">
					<div>
						<p className="wh-notice-t">
							<span className="wh-spin" aria-hidden="true" />
							Starting your delivery service
						</p>
						<p className="wh-notice-l">
							This takes about 30 seconds. Hang tight.
						</p>
					</div>
				</output>
			);
		}

		if (notice?.kind === "error") {
			return <p className="acct-error">{notice.message}</p>;
		}

		return (
			<>
				{listSummary ? (
					<>
						<p className="wh-crumb">
							<Link href="/account/webhooks">Webhooks</Link>{" "}
							<span className="wh-mono">/ {id}</span>
						</p>
						<div className="wh-h1-row">
							<h1 className="acct-h1">{listSummary.name}</h1>
							<StatusPill status={displayStatus(listSummary)} />
						</div>
					</>
				) : null}
				<WebhookDetailSkeleton hideHead={listSummary !== null} />
			</>
		);
	}

	// The webhook itself loaded, but its logs haven't (or a race lost one of
	// them) — hold the skeleton rather than render stats and tables off an
	// empty `rows`/`deadRows` that would misreport as "nothing here".
	if (!report) {
		return (
			<>
				<p className="wh-crumb">
					<Link href="/account/webhooks">Webhooks</Link>{" "}
					<span className="wh-mono">/ {webhook.id}</span>
				</p>
				<div className="wh-h1-row">
					<h1 className="acct-h1">{webhook.name}</h1>
					<StatusPill status={displayStatus(webhook)} />
				</div>
				<WebhookDetailSkeleton hideHead />
			</>
		);
	}

	async function onTest() {
		setTestBusy(true);
		setTestResult(null);
		const res = await testWebhook(id);
		setTestBusy(false);
		if (res.kind === "ok") {
			const r = res.data;
			const text = r.ok
				? `Test delivered: ${r.statusCode ?? "?"} in ${r.durationMs} ms.`
				: `Test failed: ${r.error ?? "no response"}.`;
			setTestResult({ ok: r.ok, text });
			if (r.ok) toast.success("Test event delivered", { description: text });
			else toast.error("Test event failed", { description: text });
			reload();
			return;
		}
		const text = describeFailure(res);
		setTestResult({ ok: false, text });
		toast.error("Couldn't send a test event", { description: text });
	}

	async function onTogglePause() {
		const willResume = webhook?.status === "paused";
		setPauseBusy(true);
		setActionError(null);
		const res = willResume ? await resumeWebhook(id) : await pauseWebhook(id);
		setPauseBusy(false);
		if (res.kind === "ok") {
			toast.success(willResume ? "Webhook resumed" : "Webhook paused");
			reload();
			return;
		}
		const text = describeFailure(res);
		setActionError(text);
		toast.error("Couldn't change this webhook", { description: text });
	}

	async function onRotateConfirm() {
		setRotateBusy(true);
		setActionError(null);
		const res = await rotateSecret(id);
		setRotateBusy(false);
		if (res.kind === "ok") {
			setNewSecret(res.data.signingSecret);
			setRotating("revealed");
			toast.success("Signing secret rotated", {
				description: "The old secret stopped working immediately.",
			});
			reload();
			return;
		}
		const text = describeFailure(res);
		setActionError(text);
		toast.error("Couldn't rotate the secret", { description: text });
		setRotating("idle");
	}

	async function onDeleteConfirm() {
		if (deleteName.trim() !== webhook?.name) {
			setDeleteError("Type the webhook's name exactly to confirm.");
			return;
		}
		setDeleteBusy(true);
		setDeleteError(null);
		const res = await deleteWebhook(id);
		setDeleteBusy(false);
		if (res.kind === "ok") {
			toast.success("Webhook deleted");
			router.push("/account/webhooks");
			return;
		}
		const text = describeFailure(res);
		setDeleteError(text);
		toast.error("Couldn't delete this webhook", { description: text });
	}

	async function onResendOne(outboxId: string) {
		const res = await requeue(id, outboxId);
		if (res.kind === "ok") {
			setLocallyResent((prev) => new Set(prev).add(outboxId));
			toast.success("Event resent");
			return;
		}
		toast.error("Couldn't resend that event", {
			description: describeFailure(res),
		});
	}

	async function onResendAll() {
		const targets = deadRows;
		if (targets.length === 0) return;
		resendStop.current = false;
		const total = targets.length;
		let done = 0;
		setResend({ done, total });
		for (const row of targets) {
			if (resendStop.current) break;
			let res = await requeue(id, row.id);
			if (res.kind === "rate_limited") {
				await sleep(res.retryAfter * 1000);
				if (resendStop.current) break;
				res = await requeue(id, row.id);
			}
			if (res.kind === "ok") {
				done += 1;
				setLocallyResent((prev) => new Set(prev).add(row.id));
				setResend({ done, total });
			}
		}
		setResend(null);
		if (done > 0) {
			toast.success(`Resent ${done} of ${total}`, {
				description: resendStop.current ? "Stopped early." : undefined,
			});
		} else if (resendStop.current) {
			toast("Resend stopped");
		}
	}

	const okCount = rows.filter(isSuccessDelivery).length;
	const median = medianOkDurationMs(rows);
	const deadCount = deadRows.length;
	const issues = report.issues;

	const visibleDeliveries = showAllDeliveries ? rows : rows.slice(0, 5);
	const eventsDeliveredThisWindow = activity
		? activity.hours.reduce((sum, h) => sum + h.delivered, 0)
		: null;

	const catchUp =
		isCatchingUp && activity
			? catchUpState(peakWaiting, activity.waiting, waitingHistory)
			: null;

	return (
		<>
			<p className="wh-crumb">
				<Link href="/account/webhooks">Webhooks</Link>{" "}
				<span className="wh-mono">/ {webhook.id}</span>
			</p>
			<div className="wh-head-row">
				<div className="wh-h1-row">
					<h1 className="acct-h1">{webhook.name}</h1>
					<StatusPill status={displayStatus(webhook, primary)} />
				</div>
				<div className="wh-actions">
					<button
						type="button"
						className="acct-btn line small"
						onClick={onTest}
						disabled={testBusy}
					>
						{testBusy ? "Sending..." : "Send test event"}
					</button>
					<button
						type="button"
						className="acct-btn line small"
						onClick={onTogglePause}
						disabled={pauseBusy}
					>
						{webhook.status === "paused" ? "Resume" : "Pause"}
					</button>
				</div>
			</div>

			{testResult ? (
				<p className="wh-result">
					<span className={testResult.ok ? "ok" : "bad"}>
						{testResult.text}
					</span>
				</p>
			) : null}
			{actionError ? <p className="acct-error">{actionError}</p> : null}

			{catchUp ? (
				<output className="wh-catchup">
					<p className="wh-catchup-t">
						<span>
							{sawNoCreditsRef.current
								? "Catching up after your top-up"
								: "Catching up"}
						</span>
						<span className="wh-live">live</span>
					</p>
					<div className="wh-catchup-bar">
						<b style={{ width: `${Math.round(catchUp.progress * 100)}%` }} />
					</div>
					<p className="wh-catchup-l">{catchUpCopy(catchUp)}</p>
				</output>
			) : null}

			<DiagnosisPanel
				webhook={webhook}
				issues={issues}
				primary={primary}
				deadCount={deadCount}
				deliveries={rows}
				activity={activity}
				waitingHistory={waitingHistory}
			/>

			<div className="acct-stats">
				<div className="acct-stat">
					<span className="acct-stat-k">Delivered, last 7 days</span>
					<span className="acct-stat-v">
						{eventsDeliveredThisWindow !== null ? (
							<NumberFlow value={eventsDeliveredThisWindow} />
						) : (
							"–"
						)}
					</span>
				</div>
				<div className="acct-stat">
					<span className="acct-stat-k">Ok, last 100 attempts</span>
					<span className="acct-stat-v">
						<NumberFlow value={okCount} /> <small>of {rows.length}</small>
					</span>
				</div>
				<div className="acct-stat">
					<span className="acct-stat-k">Median response</span>
					<span className="acct-stat-v">
						<NumberFlow value={median} /> <small>ms</small>
					</span>
				</div>
				<div className="acct-stat">
					<span className="acct-stat-k">Failed events</span>
					<span className="acct-stat-v">
						<NumberFlow value={deadCount} />
					</span>
				</div>
			</div>

			<div className="wh-chart">
				<div className="wh-chart-top">
					<span>Events, last 7 days</span>
					<span className="mono">
						{activity ? activityHeaderSummary(activity.hours) : "…"}
					</span>
				</div>
				<LazyMonoStackedBarChart data={activity?.hours ?? []} />
				<div className="wh-legend">
					<span>
						<i style={{ background: "var(--fig-bar)" }} />
						delivered
					</span>
					<span>
						<i style={{ background: "var(--fig-role-a)" }} />
						waiting to send
					</span>
					<span>
						<i style={{ background: "var(--fig-alarm)" }} />
						gave up after every retry
					</span>
					<span>
						One bar per hour. Each event is one POST and one billed event;
						retries are free.
					</span>
				</div>
			</div>

			<AttemptRibbon rows={rows} />

			<div className="wh-tabs" role="tablist">
				<button
					type="button"
					role="tab"
					aria-selected={tab === "deliveries"}
					onClick={() => setTab("deliveries")}
				>
					Deliveries
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === "failed"}
					onClick={() => setTab("failed")}
				>
					Failed events
					{deadCount > 0 ? <span className="n">{deadCount}</span> : null}
				</button>
			</div>
			<div role="tabpanel">
				{tab === "deliveries" ? (
					<DeliveriesTable
						allRows={rows}
						visibleRows={visibleDeliveries}
						showAll={showAllDeliveries}
						onToggleShowAll={() => {
							setShowAllDeliveries((v) => !v);
							setOpenDeliveryId(null);
						}}
						openId={openDeliveryId}
						onOpen={(deliveryId) => setOpenDeliveryId(deliveryId)}
					/>
				) : (
					<FailedEventsTable
						rows={deadRows}
						resend={resend}
						onResendOne={onResendOne}
						onResendAll={onResendAll}
						onStop={() => {
							resendStop.current = true;
						}}
					/>
				)}
			</div>

			<h2 className="acct-h2">Settings</h2>
			<dl className="wh-facts">
				<dt>Fires on</dt>
				<dd>
					<FiresOn
						kind={webhook.kind}
						subgraphName={webhook.subgraphName}
						tableName={webhook.tableName}
						triggers={webhook.triggers}
					/>
					<div className="acct-fine" style={{ marginTop: 4 }}>
						Created {formatDate(webhook.createdAt)}
					</div>
				</dd>
				<dt>Sends to</dt>
				<dd>
					<span className="wh-mono">{webhook.url}</span>
				</dd>
				<dt>Format</dt>
				<dd>{FORMAT_LABEL[webhook.format]}</dd>
				<dt>Retries</dt>
				<dd>
					<span className="wh-mono">{webhook.maxRetries}</span>{" "}
					<span className="wh-of">of 7 allowed</span>
				</dd>
				<dt>Timeout</dt>
				<dd>
					<span className="wh-mono">{webhook.timeoutMs / 1000}</span> seconds{" "}
					<span className="wh-of">of 30 allowed</span>
				</dd>
				<dt>In flight</dt>
				<dd>
					<span className="wh-mono">{webhook.concurrency}</span>{" "}
					<span className="wh-of">requests at once</span>
				</dd>
			</dl>
			<CliLine command={`secondlayer webhooks update ${webhook.id}`} />

			<DeliveryCard
				webhookId={id}
				webhookUrl={webhook.url}
				maxRetries={webhook.maxRetries}
				rows={visibleDeliveries}
				openId={openDeliveryId}
				onClose={() => setOpenDeliveryId(null)}
				onNavigate={(deliveryId) => setOpenDeliveryId(deliveryId)}
			/>

			<div className="wh-danger">
				{rotating === "revealed" && newSecret ? (
					<div className="acct-result" style={{ flex: 1 }}>
						<p className="acct-result-title">Your new signing secret</p>
						<p className="acct-result-line">
							Copy it now. It isn't stored, so this is the only time it's shown.
							The old secret stopped working immediately.
						</p>
						<div className="acct-copyrow">
							<code className="acct-field">{newSecret}</code>
							<button
								type="button"
								className="acct-btn line"
								onClick={() => {
									navigator.clipboard.writeText(newSecret).catch(() => {});
									setCopiedSecret(true);
									toast.success("Signing secret copied");
									setTimeout(() => setCopiedSecret(false), 1400);
								}}
							>
								{copiedSecret ? "Copied" : "Copy"}
							</button>
						</div>
					</div>
				) : rotating === "confirm" ? (
					<div className="acct-revoke-confirm" style={{ flex: 1 }}>
						<p>
							<strong>The old secret stops working now.</strong> Rotate?
						</p>
						<div className="acct-row-actions">
							<button
								type="button"
								className="acct-btn solid"
								onClick={onRotateConfirm}
								disabled={rotateBusy}
							>
								{rotateBusy ? "Rotating..." : "Rotate secret"}
							</button>
							<button
								type="button"
								className="acct-btn line"
								onClick={() => setRotating("idle")}
								disabled={rotateBusy}
							>
								Cancel
							</button>
						</div>
					</div>
				) : (
					<>
						<p>
							<strong>Rotate signing secret</strong>
							<br />
							The new secret is shown once. The old one stops working
							immediately.
						</p>
						<button
							type="button"
							className="acct-btn line small"
							onClick={() => setRotating("confirm")}
						>
							Rotate secret
						</button>
					</>
				)}
			</div>

			<div className="wh-danger">
				{deleting ? (
					<div className="acct-revoke-confirm" style={{ flex: 1 }}>
						<p>
							Type <strong>{webhook.name}</strong> to confirm. This stops
							deliveries and removes its history — it can't be undone.
						</p>
						<input
							className="acct-input"
							value={deleteName}
							onChange={(e) => setDeleteName(e.target.value)}
							placeholder={webhook.name}
							autoComplete="off"
						/>
						{deleteError ? <p className="acct-error">{deleteError}</p> : null}
						<div className="acct-row-actions">
							<button
								type="button"
								className="acct-btn danger"
								onClick={onDeleteConfirm}
								disabled={deleteBusy}
							>
								{deleteBusy ? "Deleting..." : "Delete webhook"}
							</button>
							<button
								type="button"
								className="acct-btn line"
								onClick={() => {
									setDeleting(false);
									setDeleteName("");
									setDeleteError(null);
								}}
								disabled={deleteBusy}
							>
								Cancel
							</button>
						</div>
					</div>
				) : (
					<>
						<p>
							<strong>Delete webhook</strong>
							<br />
							Stops deliveries and removes its history. This cannot be undone.
						</p>
						<button
							type="button"
							className="acct-btn danger"
							onClick={() => setDeleting(true)}
						>
							Delete
						</button>
					</>
				)}
			</div>
		</>
	);
}

function DeliveriesTable({
	allRows,
	visibleRows,
	showAll,
	onToggleShowAll,
	openId,
	onOpen,
}: {
	allRows: DeliveryRow[];
	visibleRows: DeliveryRow[];
	showAll: boolean;
	onToggleShowAll: () => void;
	openId: string | null;
	onOpen: (deliveryId: string) => void;
}) {
	if (allRows.length === 0) {
		return (
			<div className="wh-empty" style={{ marginTop: 12 }}>
				<p>No deliveries yet.</p>
			</div>
		);
	}
	return (
		<>
			<div className="wh-tbl-wrap" style={{ marginTop: 12 }}>
				<table className="wh-tbl">
					<thead>
						<tr>
							<th>Sent (UTC)</th>
							<th>Block</th>
							<th className="num">Try</th>
							<th>Response</th>
							<th className="num">Time</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{visibleRows.map((r) => {
							const ok = r.statusCode !== null && r.statusCode < 300;
							return (
								<tr
									key={r.id}
									className="link"
									tabIndex={0}
									aria-selected={openId === r.id}
									onClick={() => onOpen(r.id)}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											onOpen(r.id);
										}
									}}
								>
									<td className="m">
										{r.dispatchedAt.replace("T", " ").slice(0, 19)}
									</td>
									<td className="m">
										{r.blockHeight === null
											? "–"
											: r.blockHeight.toLocaleString("en-US")}
									</td>
									<td className="num">{r.attempt}</td>
									<td>
										<span className={`m ${ok ? "ok" : "bad"}`}>
											{r.statusCode ?? "no response"}
										</span>
										{r.errorMessage ? (
											<span className="dim"> {r.errorMessage}</span>
										) : null}
									</td>
									<td className="num">
										{r.durationMs === null ? "–" : `${r.durationMs} ms`}
									</td>
									<td className="num">›</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			<div className="wh-tbl-foot">
				<p className="acct-fine">
					{showAll
						? `All ${allRows.length} attempts.`
						: `Latest ${visibleRows.length} of ${allRows.length}.`}{" "}
					Retries are free.
				</p>
				{allRows.length > 5 ? (
					<button
						type="button"
						className="wh-tbl-foot-link"
						onClick={onToggleShowAll}
					>
						{showAll ? "Show latest 5" : `View all ${allRows.length}`}
					</button>
				) : null}
			</div>
		</>
	);
}

function FailedEventsTable({
	rows,
	resend,
	onResendOne,
	onResendAll,
	onStop,
}: {
	rows: DeadRow[];
	resend: { done: number; total: number } | null;
	onResendOne: (outboxId: string) => void;
	onResendAll: () => void;
	onStop: () => void;
}) {
	if (rows.length === 0) {
		return (
			<div className="wh-empty" style={{ marginTop: 12 }}>
				<p>
					No failed events. An event lands here after its last retry fails, and
					waits for you to resend it.
				</p>
			</div>
		);
	}
	return (
		<>
			<div className="wh-tbl-wrap" style={{ marginTop: 12 }}>
				<table className="wh-tbl">
					<thead>
						<tr>
							<th>Block</th>
							<th>Event</th>
							<th>Transaction</th>
							<th>Gave up</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{rows.map((d) => (
							<tr key={d.id}>
								<td className="m">{d.blockHeight}</td>
								<td className="m">{d.eventType}</td>
								<td className="m">{d.txId ?? "–"}</td>
								<td className="m">
									{formatRelative(d.failedAt)}{" "}
									<span className="dim">after {d.attempt}</span>
								</td>
								<td className="num">
									<button
										type="button"
										className="acct-btn line small"
										onClick={() => onResendOne(d.id)}
									>
										Resend
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className="wh-actions" style={{ marginTop: 10 }}>
				{resend ? (
					<>
						<span className="acct-fine">
							Resent {resend.done} of {resend.total}
						</span>
						<button
							type="button"
							className="acct-btn line small"
							onClick={onStop}
						>
							Stop
						</button>
					</>
				) : (
					<button
						type="button"
						className="acct-btn line small"
						onClick={onResendAll}
					>
						Resend all {rows.length}
					</button>
				)}
			</div>
		</>
	);
}
