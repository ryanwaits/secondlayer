"use client";

import { ChartSkeleton } from "@/components/charts/chart-skeleton";
import { LazyBandBarChart } from "@/components/charts/lazy";
import { Legend } from "@/components/dashboard/charts/legend";
import { Sparkline } from "@/components/dashboard/charts/sparkline";
import { ActionableInsights } from "@/components/dashboard/insight/insight-actions";
import { ResourceRow } from "@/components/dashboard/shell/resource-row";
import { StatusSentence } from "@/components/dashboard/shell/status-sentence";
import { refreshRows, useAccountData } from "@/lib/account-data";
import { barsRows } from "@/lib/dashboard-charts";
import type { Insight } from "@/lib/insights";
import { forAccountRules, useInsights } from "@/lib/insights-store";
import {
	type RowsError,
	type RowsResponse,
	clientErrors,
	dailyBars,
	errorSummary,
	hourlyPoints,
	markIndex,
	serverErrors,
	shortDate,
	shortenPath,
	statusCopy,
	xLabels,
} from "@/lib/rows";
import { formatRows } from "@/lib/usage";
import { useEffect, useState } from "react";
import { ageShort } from "../webhooks/view";

const SOURCE_LABEL: Record<string, string> = {
	index: "Index",
	streams: "Streams",
};

const fmt = (n: number) => n.toLocaleString("en-US");

/** The account-level rules about reads; the rest belong to Overview and Billing. */
const ROWS_RULES = [
	"duplicate_reads",
	"polling_loop",
	"backfill",
	"server_errors",
	"allowance_exhausted",
];

function ServerErrors({ errors }: { errors: RowsError[] }) {
	if (errors.length === 0) return null;
	const total = errors.reduce((sum, e) => sum + e.count, 0);
	const paths = [...new Set(errors.map((e) => shortenPath(e.path)))].join(", ");
	return (
		<p className="rw-ours">
			<span className="dash-dot alarm" />
			<span>
				{total} {total === 1 ? "read" : "reads"} failed on our side
				<span className="bl-faint"> · {paths}</span>
				<span className="bl-faint rw-ours-note">
					Our fault, not yours. You weren't billed for these.
				</span>
			</span>
		</p>
	);
}

function ErrorsPanel({ errors }: { errors: RowsError[] }) {
	const client = clientErrors(errors);
	return (
		<section className="dash-panel bl-panel" aria-label="Your errors">
			<span className="dash-label">Your errors · 24h</span>
			<ServerErrors errors={serverErrors(errors)} />
			{client.length === 0 ? (
				<p className="bl-note">No errors from you in the last 24 hours.</p>
			) : (
				<>
					<div className="wd-tbl-wrap">
						<table className="wd-tbl">
							<thead>
								<tr>
									<th>Status</th>
									<th>Path</th>
									<th className="r">Count</th>
								</tr>
							</thead>
							<tbody>
								{client.map((e) => (
									<tr key={`${e.status}-${e.code}-${e.path}`}>
										<td className="bad">{e.status}</td>
										<td className="rw-path" title={e.path}>
											{shortenPath(e.path)}
										</td>
										<td className="r">{fmt(e.count)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<span className="bl-note">{errorSummary(errors)}</span>
				</>
			)}
		</section>
	);
}

export interface RowsBodyProps {
	status: "not_loaded" | "failed" | "ok";
	data: RowsResponse | null;
	/** Insights about the account's reads, ranked by the server. */
	insights?: readonly Insight[];
	now: Date;
	onRetry: () => void;
}

/** Rows: the free allowance, rows per day, where they came from, call sizes and your errors. */
export function RowsBody({
	status,
	data,
	insights = [],
	now,
	onRetry,
}: RowsBodyProps) {
	if (status === "not_loaded" || (status === "ok" && !data)) return null;
	if (status === "failed" || !data) {
		return (
			<div className="rw-failed">
				<StatusSentence tone="alarm">Couldn't load your rows.</StatusSentence>
				<button type="button" className="acct-btn line small" onClick={onRetry}>
					Retry
				</button>
			</div>
		);
	}

	const { allowance } = data;
	const copy = statusCopy(allowance);
	const bars = dailyBars(data.daily, now);
	const mark = markIndex(bars, allowance.exhaustedOn);
	const histogram = barsRows(data.histogram.map((bin) => ({ n: bin.calls })));
	return (
		<div className="bl-body">
			<StatusSentence tone="ok" sub={copy.sub}>
				{copy.sentence}
			</StatusSentence>

			<section className="dash-panel bl-panel" aria-label="Rows per day">
				<div className="dash-panel-h">
					<span className="dash-label">Rows per day</span>
					<Legend
						items={[
							{ swatch: "square", label: "Free", color: "var(--ch-a)" },
							{ swatch: "square", label: "Paid", color: "var(--ch-b)" },
						]}
					/>
				</div>
				<div className="dc-chart">
					<LazyBandBarChart
						rows={barsRows(bars)}
						height={170}
						xLabels={xLabels(bars, allowance.exhaustedOn)}
						pointLabels={bars.map((d) => shortDate(d.date))}
						mark={
							mark === null
								? undefined
								: { index: mark, label: "free 1M used up" }
						}
						seriesNames={{ n: "Free", p: "Paid", f: "Failed" }}
					/>
				</div>
			</section>

			<div className="rw-notes">
				<ActionableInsights insights={insights} />
			</div>

			<div className="bl-two even">
				<section
					className="dash-panel bl-panel"
					aria-label="Where rows came from"
				>
					<span className="dash-label">Where rows came from · 30 days</span>
					<dl className="rw-kv">
						{data.bySource.length === 0 ? (
							<dd className="bl-faint">
								No rows delivered in the last 30 days.
							</dd>
						) : (
							data.bySource.map((s) => (
								<div key={s.source}>
									<dt>{SOURCE_LABEL[s.source] ?? s.source}</dt>
									<dd>
										{fmt(s.rows)} rows · {fmt(s.calls)} calls
									</dd>
								</div>
							))
						)}
					</dl>
					<span className="dash-label rw-sub-label">
						Rows per call · 30 days
					</span>
					<div className="dc-chart">
						<LazyBandBarChart
							rows={histogram}
							height={120}
							xLabels={data.histogram.map(
								(bin, i) =>
									[i, bin.bucket.replace("-", "–")] as [number, string],
							)}
							seriesNames={{ n: "Calls", p: "Paid", f: "Failed" }}
						/>
					</div>
				</section>
				<ErrorsPanel errors={data.errors} />
			</div>
		</div>
	);
}

/** /account/rows: loads the rows data and shows it. */
export function RowsSection() {
	const { rows } = useAccountData();
	const { data: allInsights } = useInsights();
	const [failed, setFailed] = useState(false);
	const now = new Date();

	const load = async () => {
		setFailed(false);
		const result = await refreshRows();
		if (!result) setFailed(true);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
	useEffect(() => {
		load();
	}, []);

	const status = rows ? "ok" : failed ? "failed" : "not_loaded";
	if (status === "not_loaded") return <ChartSkeleton height={170} />;
	return (
		<RowsBody
			status={status}
			data={rows}
			insights={forAccountRules(allInsights, ROWS_RULES)}
			now={now}
			onRetry={load}
		/>
	);
}

/** The Overview's row for Index and Streams reads: this month, today by hour, and when the last read landed. */
export function OverviewRowsRow({
	data,
	now,
}: { data: RowsResponse; now: Date }) {
	const { allowance } = data;
	const today = hourlyPoints(data.hourlyToday, now);
	const todayRows = today.reduce((sum, v) => sum + v, 0);
	const lastHour = data.hourlyToday.at(-1)?.hour ?? null;
	return (
		<ResourceRow
			href="/account/rows"
			name="rows"
			tone="ok"
			state={`${formatRows(allowance.usedThisMonth)} this month${
				allowance.exhaustedOn ? " · free 1M used up" : ""
			}`}
			spark={
				today.length > 1 ? (
					<Sparkline points={today} title="Rows delivered today, by hour" />
				) : null
			}
			count={formatRows(todayRows)}
			age={ageShort(lastHour)}
		/>
	);
}
