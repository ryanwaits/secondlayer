"use client";

import { formatUsd, refreshUsage, useAccountData } from "@/lib/account-data";
import { currentUtcMonth, monthLabel, monthParam } from "@/lib/usage";
import {
	type WebhooksResult,
	dismissInsight,
	formatRelative,
	hasShownToast,
	hostOf,
	isInsightDismissed,
	listWebhooks,
	markToastShown,
} from "@/lib/webhooks-data";
import NumberFlow from "@number-flow/react";
import type { DoctorIssue, WebhookSummary } from "@secondlayer/sdk";
import { buildListIssue } from "@secondlayer/sdk/webhooks/doctor";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	CliLine,
	FiresOn,
	StatusPill,
	countByDisplayStatus,
	displayStatus,
} from "./shared";

const CREATE_CMD =
	"secondlayer webhooks create --name pool-payouts --trigger stx_transfer --url https://your.app/hook";

type ListState =
	| { kind: "loading" }
	| { kind: "starting" }
	| { kind: "no_credits" }
	| { kind: "error"; message: string }
	| { kind: "ok"; data: WebhookSummary[] };

function nextState(res: WebhooksResult<WebhookSummary[]>): ListState {
	if (res.kind === "ok") return { kind: "ok", data: res.data };
	if (res.kind === "starting") return { kind: "starting" };
	if (res.kind === "no_credits") return { kind: "no_credits" };
	if (res.kind === "not_found") return { kind: "ok", data: [] };
	if (res.kind === "rate_limited") return { kind: "loading" }; // retried silently, see below
	return { kind: "error", message: res.message };
}

/** Fetches the list, and while a delivery service is starting (or the read
 *  got rate limited), polls again after the server's own `Retry-After`
 *  instead of guessing an interval. */
function useWebhooksList(): ListState {
	const [state, setState] = useState<ListState>({ kind: "loading" });

	useEffect(() => {
		let stopped = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		async function load() {
			const res = await listWebhooks();
			if (stopped) return;
			setState(nextState(res));
			if (res.kind === "starting" || res.kind === "rate_limited") {
				timer = setTimeout(load, res.retryAfter * 1000);
			}
		}

		load();
		return () => {
			stopped = true;
			if (timer) clearTimeout(timer);
		};
	}, []);

	return state;
}

function StartingNotice() {
	return (
		<output className="wh-notice wait">
			<div>
				<p className="wh-notice-t">
					<span className="wh-spin" aria-hidden="true" />
					Starting your delivery service
				</p>
				<p className="wh-notice-l">
					Your account gets its own delivery service the first time you use
					webhooks. This takes about 30 seconds.
				</p>
			</div>
		</output>
	);
}

function NoCreditsNotice() {
	return (
		<output className="wh-notice stop">
			<div>
				<p className="wh-notice-t">
					Deliveries are paused until you add credits
				</p>
				<p className="wh-notice-l">
					Your webhooks and settings are kept, and nothing is skipped: delivery
					resumes where it stopped.
				</p>
			</div>
			<a className="acct-btn solid" href="/account/credits">
				Add credits
			</a>
		</output>
	);
}

function PricingNote() {
	return (
		<p className="acct-pricing">
			<strong>$10 per 1M events delivered.</strong> Retries are free. Each
			account runs its own delivery service. Hosted limits: up to{" "}
			<strong>7 retries</strong> and a <strong>30s timeout</strong> per webhook.
			Self-hosted webhooks are never metered.
		</p>
	);
}

function EmptyState() {
	return (
		<>
			<div className="wh-empty">
				<p>
					<strong>No webhooks yet.</strong> Create one from your terminal with
					an account key. It starts delivering from the next block.
				</p>
				<CliLine command={CREATE_CMD} />
				<p>
					The signing secret is shown once, in the CLI output. Store it where
					your receiver can read it.
				</p>
			</div>
			<PricingNote />
		</>
	);
}

/** The list endpoint's own reduced doctor rule (plan 068) only ever returns
 *  `paused` or `circuit` — spell out the one useful thing each tells the
 *  reader beyond what the status pill already shows. */
function listIssueText(issue: DoctorIssue): string {
	if (issue.code === "circuit") {
		const opened = issue.evidence?.find(
			(e) => e.label === "circuit opened",
		)?.value;
		return opened
			? `Circuit breaker tripped at ${opened}. Check your receiver, then send a test event.`
			: "Circuit breaker tripped. Check your receiver, then send a test event.";
	}
	if (issue.code === "paused") {
		return "Resume when your receiver is healthy.";
	}
	return "";
}

const LIST_ISSUE_TITLE: Partial<Record<DoctorIssue["code"], string>> = {
	circuit: "Circuit breaker tripped",
	paused: "Webhook paused",
};

const EMPTY_ROWS: WebhookSummary[] = [];

export function WebhooksListSection() {
	const state = useWebhooksList();
	const router = useRouter();
	const { usage } = useAccountData();
	const month = currentUtcMonth();
	const monthKey = monthParam(month);
	// Bumped on dismiss to force a re-read of localStorage on the next render
	// — the dismiss set itself isn't React state, so nothing else would
	// trigger the re-render that hides the dismissed line.
	const [, forceRerender] = useState(0);

	useEffect(() => {
		refreshUsage(monthKey);
	}, [monthKey]);

	const rows = state.kind === "ok" ? state.data : EMPTY_ROWS;

	// Bad/warn insights toast once per (webhook, rule) — list page only, per
	// plan 068. Runs before any early return so hook order stays stable
	// across every state (`rows` is `EMPTY_ROWS` until the list actually
	// loads, so this is a no-op then).
	useEffect(() => {
		for (const w of rows) {
			const issue = buildListIssue(w);
			if (!issue) continue;
			if (isInsightDismissed(w.id, issue.code)) continue;
			if (hasShownToast(w.id, issue.code)) continue;
			const title = LIST_ISSUE_TITLE[issue.code] ?? issue.code;
			const description = listIssueText(issue);
			if (issue.severity === "bad") {
				toast.error(`${w.name}: ${title}`, { description });
			} else {
				toast.warning(`${w.name}: ${title}`, { description });
			}
			markToastShown(w.id, issue.code);
		}
	}, [rows]);

	if (state.kind === "loading") return null;

	if (state.kind === "no_credits") {
		return (
			<>
				<NoCreditsNotice />
				<PricingNote />
			</>
		);
	}

	if (state.kind === "starting") {
		return (
			<>
				<StartingNotice />
				<EmptyState />
			</>
		);
	}

	if (state.kind === "error") {
		return <p className="acct-error">{state.message}</p>;
	}

	if (rows.length === 0) return <EmptyState />;

	const delivering = countByDisplayStatus(rows, "active");
	const attention = countByDisplayStatus(rows, "error");
	const webhookUsage = usage[monthKey]?.find((r) => r.unit === "webhook.event");

	function open(id: string) {
		router.push(`/account/webhooks/${id}`);
	}

	return (
		<>
			<div className="acct-stats">
				{webhookUsage ? (
					<div className="acct-stat">
						<span className="acct-stat-k">
							Events delivered in {monthLabel(month)}
						</span>
						<span className="acct-stat-v">
							<NumberFlow
								value={Number(webhookUsage.quantity)}
								format={{ notation: "compact", maximumFractionDigits: 2 }}
							/>{" "}
							<small>{formatUsd(webhookUsage.usdMicros)}</small>
						</span>
					</div>
				) : null}
				<div className="acct-stat">
					<span className="acct-stat-k">Delivering</span>
					<span className="acct-stat-v">
						<NumberFlow value={delivering} /> <small>of {rows.length}</small>
					</span>
				</div>
				<div className="acct-stat">
					<span className="acct-stat-k">Needs attention</span>
					<span
						className="acct-stat-v"
						style={attention > 0 ? { color: "var(--red)" } : undefined}
					>
						<NumberFlow value={attention} />
					</span>
				</div>
			</div>

			<div className="wh-tbl-wrap">
				<table className="wh-tbl">
					<thead>
						<tr>
							<th>Webhook</th>
							<th>Fires on</th>
							<th>Status</th>
							<th className="num">Last delivery</th>
							<th className="num">Last success</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((w) => {
							const rawIssue = buildListIssue(w);
							const issue =
								rawIssue && !isInsightDismissed(w.id, rawIssue.code)
									? rawIssue
									: null;
							return (
								<Fragment key={w.id}>
									<tr
										className="link"
										tabIndex={0}
										onClick={() => open(w.id)}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												e.preventDefault();
												open(w.id);
											}
										}}
									>
										<td>
											{w.name}
											<span className="wh-tbl-sub wh-mono">
												{hostOf(w.url)}
											</span>
										</td>
										<td>
											<FiresOn
												kind={w.kind}
												subgraphName={w.subgraphName}
												tableName={w.tableName}
											/>
										</td>
										<td>
											<StatusPill status={displayStatus(w)} />
										</td>
										<td className={`num${w.status === "error" ? " bad" : ""}`}>
											{formatRelative(w.lastDeliveryAt)}
										</td>
										<td className="num">{formatRelative(w.lastSuccessAt)}</td>
									</tr>
									{issue ? (
										<tr className="wh-list-issue-row">
											<td colSpan={5}>
												<span className={`wh-list-issue ${issue.severity}`}>
													{listIssueText(issue)}
												</span>
												<button
													type="button"
													className="wh-list-issue-dismiss"
													onClick={(e) => {
														e.stopPropagation();
														dismissInsight(w.id, issue.code);
														forceRerender((n) => n + 1);
													}}
												>
													Dismiss
												</button>
											</td>
										</tr>
									) : null}
								</Fragment>
							);
						})}
					</tbody>
				</table>
			</div>
			<p className="acct-fine left">
				New webhook: <code>secondlayer webhooks create</code>. Edit one:{" "}
				<code>secondlayer webhooks update &lt;id&gt;</code>.
			</p>
			<PricingNote />
		</>
	);
}
