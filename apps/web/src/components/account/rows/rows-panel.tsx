"use client";

import { ChartBox } from "@/components/charts/chart-skeleton";
import {
	LazyBandBarChart,
	preloadBandBarChart,
} from "@/components/charts/lazy";
import { Legend } from "@/components/dashboard/charts/legend";
import { Meter } from "@/components/dashboard/charts/meter";
import { InsightLine } from "@/components/dashboard/insight/insight-line";
import { ReadsKeyLine } from "@/components/dashboard/shell/onboarding";
import { Skel } from "@/components/dashboard/shell/skel";
import { StatusSentence } from "@/components/dashboard/shell/status-sentence";
import { ensureKeys, refreshRows, useAccountData } from "@/lib/account-data";
import { barsRows } from "@/lib/dashboard-charts";
import { type Insight, rulesHomedAt } from "@/lib/insights";
import { forAccountRules, useInsights } from "@/lib/insights-store";
import {
	type KeyState,
	READ_COMMAND,
	keyState as keyStateOf,
} from "@/lib/onboarding";
import {
	ERRORS_PER_PAGE,
	type RowsError,
	type RowsResponse,
	clientErrors,
	dailyBars,
	errorPage,
	errorSummary,
	markIndex,
	serverErrors,
	shortDate,
	shortenPath,
	statusCopy,
	xLabels,
} from "@/lib/rows";
import { ROWS_ALLOWANCE, formatRows } from "@/lib/usage";
import { useEffect, useState } from "react";
import { CliLine } from "../webhooks/shared";

const SOURCE_LABEL: Record<string, string> = {
	index: "Index",
	streams: "Streams",
};

const fmt = (n: number) => n.toLocaleString("en-US");

/** The account rules whose insights live here. */
const ROWS_RULES = rulesHomedAt("/account/rows");

function ServerErrors({ errors }: { errors: RowsError[] }) {
	if (errors.length === 0) return null;
	const total = errors.reduce((sum, e) => sum + e.count, 0);
	const paths = [...new Set(errors.map((e) => shortenPath(e.path)))].join(", ");
	return (
		<p className="rw-ours">
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

function PageArrow({ back }: { back?: boolean }) {
	return (
		<svg
			width="6"
			height="10"
			viewBox="0 0 6 10"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d={back ? "M5 1L1 5l4 4" : "M1 1l4 4-4 4"} />
		</svg>
	);
}

/** Your 4xx errors, a page at a time so the panel ends level with its neighbour:
 *  one row fewer when our own failures take a line above the table. */
function ErrorsPanel({ errors }: { errors: RowsError[] }) {
	const client = clientErrors(errors);
	const ours = serverErrors(errors);
	const [page, setPage] = useState(0);
	const { rows, from, to, pages, current } = errorPage(
		client,
		page,
		ours.length > 0 ? ERRORS_PER_PAGE - 1 : ERRORS_PER_PAGE,
	);
	return (
		<section className="dash-panel bl-panel" aria-label="Your errors">
			<div className="dash-panel-h">
				<span className="dash-label">Your errors · 24h</span>
				{client.length > 0 ? (
					<span className="rw-err-meta">
						<span className="bl-note">{errorSummary(errors)}</span>
						{pages > 1 ? (
							<nav className="rw-pager" aria-label="Error pages">
								<span className="bl-note">
									{from}–{to} of {client.length}
								</span>
								<button
									type="button"
									aria-label="Previous errors"
									disabled={current === 0}
									onClick={() => setPage(current - 1)}
								>
									<PageArrow back />
								</button>
								<button
									type="button"
									aria-label="Next errors"
									disabled={current === pages - 1}
									onClick={() => setPage(current + 1)}
								>
									<PageArrow />
								</button>
							</nav>
						) : null}
					</span>
				) : null}
			</div>
			<ServerErrors errors={ours} />
			{client.length === 0 ? (
				<p className="bl-note">No errors from you in the last 24 hours.</p>
			) : (
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
							{rows.map((e) => (
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
	/** The account has no key of its own yet: the empty screen asks for one first. */
	keyState?: KeyState;
}

/** Nothing read this month and nothing on record. */
const isUnused = (data: RowsResponse) =>
	data.allowance.usedThisMonth === 0 && data.daily.length === 0;

/** A new account's Rows: what will show up here, and the one step to get it. */
function EmptyRows({
	data,
	keyState,
	insights,
}: {
	data: RowsResponse;
	keyState: KeyState;
	insights: readonly Insight[];
}) {
	return (
		<div className="bl-body">
			<StatusSentence sub="Every row you read shows up here by day, with what it cost. The first 1M each month are free.">
				No reads yet.
			</StatusSentence>
			<InsightLine insights={insights} />
			{keyState === "first" || keyState === "none_active" ? (
				<ReadsKeyLine state={keyState} />
			) : (
				<CliLine command={READ_COMMAND} />
			)}
			<section className="dash-panel bl-panel" aria-label="Rows per day">
				<span className="dash-label">Rows per day</span>
				<div className="ob-chart-empty">Your first read shows up here</div>
				<Meter
					used={0}
					total={ROWS_ALLOWANCE}
					label="Free rows used this month"
					left={`0 of ${formatRows(ROWS_ALLOWANCE)} free rows`}
					right={`resets ${shortDate(data.allowance.resetsOn)}`}
				/>
			</section>
		</div>
	);
}

/** Rows: the free allowance, rows per day, where they came from, call sizes and your errors. */
export function RowsBody({
	status,
	data,
	insights = [],
	now,
	onRetry,
	keyState = "active",
}: RowsBodyProps) {
	if (status === "not_loaded" || (status === "ok" && !data)) return null;
	if (status === "failed" || !data) {
		return (
			<div className="rw-failed">
				<StatusSentence>Couldn't load your rows.</StatusSentence>
				<button type="button" className="acct-btn line small" onClick={onRetry}>
					Retry
				</button>
			</div>
		);
	}

	if (isUnused(data))
		return <EmptyRows data={data} keyState={keyState} insights={insights} />;

	const { allowance } = data;
	const copy = statusCopy(allowance);
	const bars = dailyBars(data.daily, now);
	const mark = markIndex(bars, allowance.exhaustedOn);
	const histogram = barsRows(data.histogram.map((bin) => ({ n: bin.calls })));
	return (
		<div className="bl-body">
			<StatusSentence sub={copy.sub}>{copy.sentence}</StatusSentence>
			<InsightLine insights={insights} />
			{keyState === "none_active" ? <ReadsKeyLine state="none_active" /> : null}

			<section className="dash-panel bl-panel" aria-label="Rows per day">
				<div className="dash-panel-h">
					<span className="dash-label">Rows per day</span>
					<Legend
						items={[
							{ swatch: "square", label: "Free", color: "var(--ch-b)" },
							{ swatch: "square", label: "Paid", color: "var(--ch-a)" },
						]}
					/>
				</div>
				<ChartBox height={170}>
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
						emphasis="p"
					/>
				</ChartBox>
			</section>

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
					<ChartBox height={120}>
						<LazyBandBarChart
							rows={histogram}
							height={120}
							xLabels={data.histogram.map(
								(bin, i) =>
									[i, bin.bucket.replace("-", "–")] as [number, string],
							)}
							seriesNames={{ n: "Calls", p: "Paid", f: "Failed" }}
						/>
					</ChartBox>
				</section>
				<ErrorsPanel errors={data.errors} />
			</div>
		</div>
	);
}

/** The Rows screen's shape while it loads: real labels, boxes at their final heights. */
export function RowsSkeleton() {
	return (
		<output className="bl-body" aria-busy="true" aria-label="Loading rows">
			<div className="dash-status-wrap">
				<h1 className="dash-status">
					<Skel width={260} height={22} />
				</h1>
				<p className="dash-status-sub">
					<Skel width={320} />
				</p>
			</div>
			<section className="dash-panel bl-panel">
				<span className="dash-label">Rows per day</span>
				<ChartBox height={170} />
			</section>
			<div className="bl-two even">
				<section className="dash-panel bl-panel">
					<span className="dash-label">Where rows came from · 30 days</span>
					<Skel width="60%" />
					<Skel width="60%" />
					<span className="dash-label rw-sub-label">
						Rows per call · 30 days
					</span>
					<ChartBox height={120} />
				</section>
				<section className="dash-panel bl-panel">
					<span className="dash-label">Your errors · 24h</span>
					<Skel width="80%" />
					<Skel width="80%" />
					<Skel width="80%" />
				</section>
			</div>
		</output>
	);
}

/** /account/rows: loads the rows data and shows it. */
export function RowsSection() {
	const { rows, keys } = useAccountData();
	const { data: allInsights, status: insightsStatus } = useInsights();
	const [failed, setFailed] = useState(false);
	const now = new Date();

	const load = async () => {
		setFailed(false);
		const result = await refreshRows();
		if (!result) setFailed(true);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
	useEffect(() => {
		// The page carries the rows; read them here only when it couldn't.
		if (!rows) load();
		preloadBandBarChart();
		ensureKeys();
	}, []);

	const status = rows ? "ok" : failed ? "failed" : "not_loaded";
	// Insights sit above the rows, so they land with them or the rows move.
	if (!failed && (rows === null || insightsStatus === "idle")) {
		return <RowsSkeleton />;
	}
	return (
		<RowsBody
			status={status}
			data={rows}
			insights={forAccountRules(allInsights, ROWS_RULES)}
			now={now}
			onRetry={load}
			keyState={keyStateOf(keys, now)}
		/>
	);
}
