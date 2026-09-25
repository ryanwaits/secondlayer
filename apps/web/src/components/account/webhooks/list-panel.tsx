"use client";

import { formatUsd, refreshUsage, useAccountData } from "@/lib/account-data";
import {
	currentUtcMonth,
	formatRows,
	monthLabel,
	monthParam,
} from "@/lib/usage";
import {
	type WebhooksResult,
	formatRelative,
	hostOf,
	listWebhooks,
} from "@/lib/webhooks-data";
import type { WebhookSummary } from "@secondlayer/sdk";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CliLine, FiresOn, StatusPill } from "./shared";

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

export function WebhooksListSection() {
	const state = useWebhooksList();
	const router = useRouter();
	const { usage } = useAccountData();
	const month = currentUtcMonth();
	const monthKey = monthParam(month);

	useEffect(() => {
		refreshUsage(monthKey);
	}, [monthKey]);

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

	const rows = state.data;
	if (rows.length === 0) return <EmptyState />;

	const delivering = rows.filter((w) => w.status === "active").length;
	const attention = rows.filter((w) => w.status === "error").length;
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
							{formatRows(webhookUsage.quantity)}{" "}
							<small>{formatUsd(webhookUsage.usdMicros)}</small>
						</span>
					</div>
				) : null}
				<div className="acct-stat">
					<span className="acct-stat-k">Delivering</span>
					<span className="acct-stat-v">
						{delivering} <small>of {rows.length}</small>
					</span>
				</div>
				<div className="acct-stat">
					<span className="acct-stat-k">Needs attention</span>
					<span
						className="acct-stat-v"
						style={attention > 0 ? { color: "var(--red)" } : undefined}
					>
						{attention}
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
						{rows.map((w) => (
							<tr
								key={w.id}
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
									<span className="wh-tbl-sub wh-mono">{hostOf(w.url)}</span>
								</td>
								<td>
									<FiresOn
										kind={w.kind}
										subgraphName={w.subgraphName}
										tableName={w.tableName}
									/>
								</td>
								<td>
									<StatusPill status={w.status} />
								</td>
								<td className={`num${w.status === "error" ? " bad" : ""}`}>
									{formatRelative(w.lastDeliveryAt)}
								</td>
								<td className="num">{formatRelative(w.lastSuccessAt)}</td>
							</tr>
						))}
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
