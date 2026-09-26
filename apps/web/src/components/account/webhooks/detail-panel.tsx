"use client";

import { formatDate } from "@/lib/account-data";
import {
	deleteWebhook,
	formatRelative,
	getDead,
	getDeliveries,
	getWebhook,
	pauseWebhook,
	requeue,
	resumeWebhook,
	rotateSecret,
	testWebhook,
} from "@/lib/webhooks-data";
import type { WebhooksResult } from "@/lib/webhooks-data";
import NumberFlow from "@number-flow/react";
import type {
	DeadRow,
	DeliveryRow,
	WebhookDetail,
	WebhookFormat,
} from "@secondlayer/sdk";
import {
	buildDoctorReport,
	isSuccessDelivery,
} from "@secondlayer/sdk/webhooks/doctor";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AttemptsChart, medianOkDurationMs } from "./chart";
import { DiagnosisPanel } from "./diagnosis";
import { CliLine, FiresOn, StatusPill } from "./shared";

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

type DetailState =
	| { kind: "loading" }
	| { kind: "starting" }
	| { kind: "no_credits" }
	| { kind: "not_found" }
	| { kind: "error"; message: string }
	| { kind: "ok"; webhook: WebhookDetail };

function useWebhookDetail(id: string): {
	state: DetailState;
	reload: () => void;
} {
	const [state, setState] = useState<DetailState>({ kind: "loading" });
	const loadRef = useRef<() => void>(() => {});

	useEffect(() => {
		let stopped = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		async function load() {
			const res = await getWebhook(id);
			if (stopped) return;
			if (res.kind === "ok") {
				setState({ kind: "ok", webhook: res.data });
				return;
			}
			if (res.kind === "starting") {
				setState({ kind: "starting" });
				timer = setTimeout(load, res.retryAfter * 1000);
				return;
			}
			if (res.kind === "rate_limited") {
				timer = setTimeout(load, res.retryAfter * 1000);
				return;
			}
			if (res.kind === "no_credits") {
				setState({ kind: "no_credits" });
				return;
			}
			if (res.kind === "not_found") {
				setState({ kind: "not_found" });
				return;
			}
			setState({ kind: "error", message: res.message });
		}

		loadRef.current = load;
		load();
		return () => {
			stopped = true;
			if (timer) clearTimeout(timer);
		};
	}, [id]);

	return { state, reload: () => loadRef.current() };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function WebhookDetailSection({ id }: { id: string }) {
	const router = useRouter();
	const { state, reload } = useWebhookDetail(id);
	const webhook = state.kind === "ok" ? state.webhook : null;

	const [deliveries, setDeliveries] = useState<DeliveryRow[] | null>(null);
	const [dead, setDead] = useState<DeadRow[] | null>(null);
	const [tab, setTab] = useState<"deliveries" | "failed">("deliveries");

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

	// `webhook` is a fresh object on every successful load, including a
	// reload after test/pause/rotate — so depending on it re-fetches the log
	// whenever any of those actions might have changed it.
	useEffect(() => {
		if (!webhook) return;
		let stopped = false;
		async function loadLogs() {
			const [d, x] = await Promise.all([getDeliveries(id), getDead(id)]);
			if (stopped) return;
			if (d.kind === "ok") setDeliveries(d.data);
			if (x.kind === "ok") setDead(x.data);
		}
		loadLogs();
		return () => {
			stopped = true;
		};
	}, [webhook, id]);

	if (state.kind === "loading") return null;

	if (state.kind === "not_found") {
		return (
			<p className="acct-muted">
				That webhook doesn't exist, or belongs to a different account. Back to{" "}
				<Link href="/account/webhooks">Webhooks</Link>.
			</p>
		);
	}

	if (state.kind === "no_credits") {
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

	if (state.kind === "starting") {
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

	if (state.kind === "error") {
		return <p className="acct-error">{state.message}</p>;
	}

	if (!webhook) return null;

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
			setDead((prev) => prev?.filter((r) => r.id !== outboxId) ?? prev);
			toast.success("Event resent");
			return;
		}
		toast.error("Couldn't resend that event", {
			description: describeFailure(res),
		});
	}

	async function onResendAll() {
		const rows = dead ?? [];
		if (rows.length === 0) return;
		resendStop.current = false;
		const total = rows.length;
		let done = 0;
		setResend({ done, total });
		for (const row of rows) {
			if (resendStop.current) break;
			let res = await requeue(id, row.id);
			if (res.kind === "rate_limited") {
				await sleep(res.retryAfter * 1000);
				if (resendStop.current) break;
				res = await requeue(id, row.id);
			}
			if (res.kind === "ok") {
				done += 1;
				setDead((prev) => prev?.filter((r) => r.id !== row.id) ?? prev);
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

	const rows = deliveries ?? [];
	const okCount = rows.filter(isSuccessDelivery).length;
	const median = medianOkDurationMs(rows);
	const deadRows = dead ?? [];
	// `subgraph: null` — the dashboard never fetches subgraph status, so the
	// two subgraph issue codes (subgraph_gaps/subgraph_catching_up) never fire
	// here; the CLI passes the real subgraph status and can see them.
	const report = buildDoctorReport({
		webhook,
		deliveries: rows,
		dead: deadRows,
		subgraph: null,
	});
	const issues = report.issues;
	const primary = report.primary;
	const deadCount = deadRows.length;

	return (
		<>
			<p className="wh-crumb">
				<Link href="/account/webhooks">Webhooks</Link>{" "}
				<span className="wh-mono">/ {webhook.id}</span>
			</p>
			<div className="wh-head-row">
				<div className="wh-h1-row">
					<h1 className="acct-h1">{webhook.name}</h1>
					<StatusPill status={webhook.status} />
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

			<DiagnosisPanel
				webhook={webhook}
				issues={issues}
				primary={primary}
				deadCount={deadCount}
			/>

			<div className="wh-chart">
				<div className="wh-chart-top">
					<span>Last 100 attempts</span>
					<span className="mono">
						<NumberFlow value={okCount} /> ok · median{" "}
						<NumberFlow value={median} /> ms
					</span>
				</div>
				<AttemptsChart rows={rows} />
				<div className="wh-legend">
					<span>
						<i style={{ background: "var(--accent-blue)" }} />
						2xx, bar height is response time
					</span>
					<span>
						<i style={{ background: "var(--red)" }} />
						error or timeout
					</span>
				</div>
			</div>

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
			<p className="acct-fine left">
				Change any of these with{" "}
				<code>secondlayer webhooks update {webhook.id}</code>.
			</p>

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
					<DeliveriesTable rows={rows} />
				) : (
					<FailedEventsTable
						rows={dead ?? []}
						resend={resend}
						onResendOne={onResendOne}
						onResendAll={onResendAll}
						onStop={() => {
							resendStop.current = true;
						}}
					/>
				)}
			</div>

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

			<CliLine command={`secondlayer webhooks update ${webhook.id}`} />
		</>
	);
}

function DeliveriesTable({ rows }: { rows: DeliveryRow[] }) {
	if (rows.length === 0) {
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
							<th>Sent</th>
							<th>Block time</th>
							<th className="num">Try</th>
							<th>Response</th>
							<th className="num">Time</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((r) => {
							const ok = r.statusCode !== null && r.statusCode < 300;
							return (
								<tr key={r.id}>
									<td className="m">
										{r.dispatchedAt.replace("T", " ").slice(0, 19)}
									</td>
									<td className="m">
										{r.blockTime
											? r.blockTime.replace("T", " ").slice(0, 19)
											: "–"}
									</td>
									<td className="num">{r.attempt}</td>
									<td>
										<span className={`m ${ok ? "ok" : "bad"}`}>
											{r.statusCode ?? "no response"}
										</span>
										{r.errorMessage ? (
											<span className="dim"> {r.errorMessage}</span>
										) : null}
										{r.responseBody ? (
											<details className="wh-body">
												<summary>Response body</summary>
												<pre>{r.responseBody}</pre>
											</details>
										) : null}
									</td>
									<td className="num">{r.durationMs ?? "–"} ms</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			<p className="acct-fine left" style={{ marginTop: 8 }}>
				Latest 100 attempts are kept. Retries are free.
			</p>
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
