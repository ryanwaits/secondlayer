"use client";

import { Meter } from "@/components/dashboard/charts/meter";
import { Sparkline } from "@/components/dashboard/charts/sparkline";
import {
	ActionableInsights,
	InsightActions,
} from "@/components/dashboard/insight/insight-actions";
import { InsightCard } from "@/components/dashboard/insight/insight-card";
import {
	ResourceRow,
	ResourceRowHead,
} from "@/components/dashboard/shell/resource-row";
import { StatusSentence } from "@/components/dashboard/shell/status-sentence";
import {
	type Billing,
	formatDate,
	formatUsd,
	refreshBilling,
	refreshCaps,
	refreshKeys,
	refreshRows,
	refreshUsage,
	useAccountData,
} from "@/lib/account-data";
import { daysLeft, daysLeftLabel } from "@/lib/account-health";
import type { Insight } from "@/lib/insights";
import { forAccountRules, useInsights } from "@/lib/insights-store";
import type { ApiKey } from "@/lib/types";
import {
	type Burn,
	type HostedStack,
	ROWS_ALLOWANCE,
	currentUtcMonth,
	deliveredRowsIn,
	formatRows,
	latestMemoryHour,
	monthLabel,
	monthParam,
} from "@/lib/usage";
import { poll, refreshList, refreshSummary } from "@/lib/webhooks-store";
import Link from "next/link";
import { useEffect, useState } from "react";
import { overviewKeys } from "../keys/key-view";
import { OverviewRowsRow } from "../rows/rows-panel";
import { OverviewSubgraphsRows } from "../subgraphs/list-screen";
import {
	StateCell,
	type WebhookRowModel,
	useWebhookRows,
} from "../webhooks/rows";
import { shortenName } from "../webhooks/shared";
import { ageShort, last24 } from "../webhooks/view";

/** The webhook rows refresh this often while the tab is visible. */
const POLL_MS = 30_000;

/** The account-level rules the Overview shows; the rest belong to Rows. */
export const OVERVIEW_ACCOUNT_RULES = [
	"server_errors",
	"cap_pace",
	"credits_runway",
];

/** Rows (Index and Streams reads) get their own row here, once their data has loaded. */
export function OverviewRowsSlot() {
	const { rows } = useAccountData();
	useEffect(
		() =>
			poll(async () => {
				await refreshRows();
				return {};
			}, 60_000),
		[],
	);
	return rows ? <OverviewRowsRow data={rows} now={new Date()} /> : null;
}

/** One row per subgraph, once the hosted stack exists (reading subgraphs goes
 *  through it, so nothing is fetched before then). */
export function OverviewSubgraphsSlot() {
	const { service } = useAccountData();
	const stackExists = service !== null && service.state !== "none";
	return stackExists ? <OverviewSubgraphsRows /> : null;
}

/** Your keys: how many, which one read last, and a stale one if there is one. Hidden with no keys of your own. */
export function OverviewKeysRow({
	keys,
	now,
}: { keys: ApiKey[] | null; now: Date }) {
	const view = overviewKeys(keys, now);
	if (!view) return null;
	return (
		<ResourceRow
			href="/account/keys"
			name="keys"
			tone={view.tone}
			state={view.state}
			spark={
				view.spark ? (
					<Sparkline
						points={view.spark}
						title="Rows read with your keys per day, last 24 days"
					/>
				) : null
			}
			count={view.count}
			age={view.age}
		/>
	);
}

const plural = (n: number, one: string, many = `${one}s`) =>
	`${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function WebhookRow({ model }: { model: WebhookRowModel }) {
	const [open, setOpen] = useState(false);
	const { webhook, series, state, insights } = model;
	const recent = last24(series);
	const top = insights[0];
	return (
		<div className="dash-row-wrap">
			<ResourceRow
				href={`/account/webhooks/${webhook.id}`}
				name={shortenName(webhook.name)}
				nameTitle={webhook.name}
				tone={state.tone}
				state={
					<StateCell
						model={model}
						open={open}
						onToggle={() => setOpen((v) => !v)}
					/>
				}
				spark={
					recent.delivered.length > 0 ? (
						<Sparkline
							points={recent.delivered}
							fails={recent.failed}
							title={`${webhook.name}, deliveries per hour, last 24 hours`}
						/>
					) : null
				}
				count={recent.delivered
					.reduce((a, b) => a + b, 0)
					.toLocaleString("en-US")}
				age={ageShort(webhook.lastDeliveryAt)}
			/>
			{open && top ? (
				<InsightCard insight={top} footer={<InsightActions insight={top} />} />
			) : null}
		</div>
	);
}

/** Webhooks that have never matched an event: one quiet row that expands. */
function QuietGroup({ models }: { models: WebhookRowModel[] }) {
	const [open, setOpen] = useState(false);
	if (models.length === 0) return null;
	return (
		<div className="dash-row-wrap">
			<button
				type="button"
				className="dash-row ov-group"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
			>
				<span className="dash-row-name">
					<span className="dash-dot idle" />
					<span>{plural(models.length, "more webhook")}</span>
				</span>
				<span className="dash-row-state">Waiting for their first match</span>
				<span className="dash-row-spark" />
				<span className="dash-row-v ov-faint">0</span>
				<span className="dash-row-t ov-faint">{open ? "▴" : "▾"}</span>
			</button>
			{open ? (
				<div className="ov-sub-rows">
					{models.map(({ webhook }) => (
						<ResourceRow
							key={webhook.id}
							href={`/account/webhooks/${webhook.id}`}
							name={shortenName(webhook.name)}
							nameTitle={webhook.name}
							tone="idle"
							state={`Waiting since ${formatDate(webhook.createdAt)}`}
							count="0"
							age="–"
						/>
					))}
				</div>
			) : null}
		</div>
	);
}

function StackRow({
	stack,
	burn,
}: { stack: HostedStack | null; burn: Burn | null }) {
	if (!stack) return null;
	const latest = latestMemoryHour(stack.memory24h);
	if (stack.state === "none") {
		return (
			<ResourceRow
				href="/account/credits"
				name="hosted stack"
				tone="idle"
				state="Not started · starts with your first webhook"
				age=""
			/>
		);
	}
	const running = stack.state === "running";
	return (
		<ResourceRow
			href="/account/credits"
			name="hosted stack"
			tone={running ? "ok" : "alarm"}
			state={
				running
					? `Running${latest ? ` · ${(latest.observedGb ?? latest.billedGb).toFixed(2)} GB` : ""} · runs your webhooks`
					: "Stopped · add credits to start it again"
			}
			spark={
				stack.memory24h.length > 1 ? (
					<Sparkline
						points={stack.memory24h.map((m) => m.observedGb ?? m.billedGb)}
						title="Hosted stack memory, last 24 hours"
					/>
				) : null
			}
			count={burn ? `${formatUsd(burn.rateDayUsdMicros)}/d` : undefined}
			age=""
		/>
	);
}

function MonthPanel({
	billing,
	burn,
	deliveredRows,
}: {
	billing: Billing | null;
	burn: Burn | null;
	deliveredRows: number | null;
}) {
	const runway = daysLeftLabel(daysLeft(billing, burn));
	return (
		<section className="dash-panel" aria-label="This month">
			<div className="dash-panel-h">
				<span className="dash-label">{monthLabel(currentUtcMonth())}</span>
				<Link href="/account/credits" className="dash-link">
					Billing ›
				</Link>
			</div>
			<div className="dash-big">
				{billing ? formatUsd(billing.spentThisMonthUsdMicros) : "–"}{" "}
				<span>
					spent
					{billing
						? ` · ${formatUsd(billing.creditsUsdMicros)} left${runway ? `, ${runway}` : ""}`
						: ""}
				</span>
			</div>
			{deliveredRows !== null ? (
				<Meter
					used={Math.min(deliveredRows, ROWS_ALLOWANCE)}
					total={ROWS_ALLOWANCE}
					label="Free rows used this month"
					left={`${formatRows(Math.min(deliveredRows, ROWS_ALLOWANCE))} of ${formatRows(ROWS_ALLOWANCE)} free rows used`}
					right={
						deliveredRows > ROWS_ALLOWANCE
							? `${formatRows(deliveredRows - ROWS_ALLOWANCE)} paid`
							: undefined
					}
				/>
			) : null}
		</section>
	);
}

export interface OverviewBodyProps {
	/** Null until the webhook list has loaded. */
	rows: WebhookRowModel[] | null;
	billing: Billing | null;
	burn: Burn | null;
	stack: HostedStack | null;
	deliveredRows: number | null;
	/** The account's API keys; null until they have loaded. */
	keys?: ApiKey[] | null;
	/** The clock for the keys row; defaults to now. */
	now?: Date;
	/** Account-level insights (read errors, spend cap, credits). */
	accountInsights?: readonly Insight[];
	/** The hosted stack stopped because every webhook is paused. */
	asleep?: boolean;
}

/** The Overview: one sentence, a row per resource, and the month. */
export function OverviewBody({
	rows,
	billing,
	burn,
	stack,
	deliveredRows,
	keys = null,
	now = new Date(),
	accountInsights = [],
	asleep = false,
}: OverviewBodyProps) {
	const attention = rows?.filter((r) => r.state.tone === "alarm").length ?? 0;
	const active = rows?.filter((r) => r.webhook.lastDeliveryAt !== null) ?? [];
	const quiet = rows?.filter((r) => r.webhook.lastDeliveryAt === null) ?? [];

	const sub = [
		rows ? plural(rows.length, "webhook") : null,
		billing ? `${formatUsd(billing.creditsUsdMicros)} in credits` : null,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<>
			{rows === null && asleep ? (
				<StatusSentence
					tone="idle"
					sub="Every webhook is paused, so it isn't billed. Wake it from Webhooks."
				>
					Your hosted stack is asleep.
				</StatusSentence>
			) : rows === null ? (
				<StatusSentence tone="idle" sub={sub || undefined}>
					Checking your account.
				</StatusSentence>
			) : attention > 0 ? (
				<StatusSentence tone="alarm" sub={sub}>
					{plural(attention, "webhook")} {attention === 1 ? "needs" : "need"}{" "}
					attention.
				</StatusSentence>
			) : rows.length === 0 ? (
				<StatusSentence tone="idle" sub={sub}>
					No webhooks yet.
				</StatusSentence>
			) : (
				<StatusSentence tone="ok" sub={sub}>
					Everything is delivering.
				</StatusSentence>
			)}

			<div className="dash-rows">
				<ResourceRowHead
					labels={["Resource", "State", "Last 24h", "Count", "Last"]}
				/>
				{active.map((model) => (
					<WebhookRow key={model.webhook.id} model={model} />
				))}
				<QuietGroup models={quiet} />
				<OverviewRowsSlot />
				<OverviewKeysRow keys={keys} now={now} />
				<StackRow stack={stack} burn={burn} />
				<OverviewSubgraphsSlot />
			</div>

			<ActionableInsights insights={accountInsights} />

			<MonthPanel billing={billing} burn={burn} deliveredRows={deliveredRows} />
		</>
	);
}

/** /account: is everything running, what needs you, what it costs. */
export function OverviewSection() {
	const { billing, burn, keys, service, usage } = useAccountData();
	const { rows } = useWebhookRows();
	const { data: insights } = useInsights();
	const month = monthParam(currentUtcMonth());

	useEffect(() => {
		refreshBilling();
		refreshCaps();
		refreshKeys();
	}, []);

	// Every 60s while the tab is visible, as the usage page does; this is
	// also what keeps burn and the hosted stack's state current.
	useEffect(() => {
		return poll(async () => {
			await refreshUsage(month);
			return {};
		}, 60_000);
	}, [month]);

	// Listing webhooks goes through the account's hosted stack, so only do it
	// once usage says one exists.
	const stackExists = service !== null && service.state !== "none";
	const [asleep, setAsleep] = useState(false);
	useEffect(() => {
		if (!stackExists) return;
		return poll(async () => {
			const [list] = await Promise.all([refreshList(), refreshSummary()]);
			setAsleep(list.kind === "asleep");
			return list.kind === "starting" || list.kind === "rate_limited"
				? { retryAfterMs: list.retryAfter * 1000 }
				: {};
		}, POLL_MS);
	}, [stackExists]);

	const monthRows = usage[month];
	return (
		<OverviewBody
			// No hosted stack means no webhooks, so there is nothing to wait for.
			rows={rows ?? (service?.state === "none" ? [] : null)}
			billing={billing}
			burn={burn}
			stack={service}
			deliveredRows={monthRows ? deliveredRowsIn(monthRows) : null}
			keys={keys}
			accountInsights={forAccountRules(insights, OVERVIEW_ACCOUNT_RULES)}
			asleep={asleep}
		/>
	);
}
