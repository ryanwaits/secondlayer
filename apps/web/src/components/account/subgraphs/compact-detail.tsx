"use client";

import { ChartSkeleton } from "@/components/charts/chart-skeleton";
import { NameMark } from "@/components/dashboard/shell/name-mark";
import { Skel } from "@/components/dashboard/shell/skel";
import { type Insight, rankInsights } from "@/lib/insights";
import {
	blocksLabel,
	formatBytes,
	groupDigits,
	handlerErrors24h,
	subgraphTone,
} from "@/lib/subgraph-view";
import type {
	SubgraphDetailData,
	SubgraphErrorGroup,
	SubgraphHealthData,
} from "@/lib/subgraphs-store";
import { JsonView } from "../webhooks/payload-view";
import { WhatsHappening } from "../webhooks/whats-happening";
import { HandlerErrorsPanel, RowsWrittenPanel } from "./health-panels";
import { useNewestRow } from "./schema-drawer";

const CHART_SKELETON_HEIGHT = 206;

export interface SubgraphCompactDetailProps {
	detail: SubgraphDetailData;
	/** The last 24 hours: facts, tone and the chart. */
	health: SubgraphHealthData | undefined;
	errors: readonly SubgraphErrorGroup[];
	/** Insights about this subgraph, ranked by the server. */
	insights?: readonly Insight[];
	/** The clock the handler-error window is read against; tests pin it. */
	now?: number;
}

/** The newest row of the first table, as JSON. Reads once the page is open. */
function NewestRowBlock({ name, table }: { name: string; table: string }) {
	const newest = useNewestRow(name, table, true);
	return (
		<section className="msg-newest" aria-label="Newest row">
			<span className="dash-label">Newest {table} row</span>
			{newest.status === "loading" ? (
				<Skel width="100%" height={96} style={{ display: "block" }} />
			) : newest.row ? (
				<div className="sg-newest">
					<JsonView value={newest.row} />
				</div>
			) : (
				<p className="m-sub">No rows yet.</p>
			)}
		</section>
	);
}

/**
 * A subgraph's page on a phone: facts, what is wrong, rows written in the last
 * day, the tables and the newest row. It reports; queries and changes happen
 * at a desk, so no command shows.
 */
export function SubgraphCompactDetail({
	detail,
	health,
	errors,
	insights,
	now,
}: SubgraphCompactDetailProps) {
	const tables = Object.entries(detail.tables);
	const errors24h = handlerErrors24h(health);
	const tone = subgraphTone(detail.status, errors24h);
	const totalRows = tables.reduce((sum, [, t]) => sum + t.rowCount, 0);
	const top = rankInsights([...(insights ?? [])])[0];
	const firstTable = tables[0]?.[0];
	const fact = (label: string, value: string, bad = false) => (
		<div>
			<span className="mwh-k">{label}</span>
			<span className={`mwh-v${bad ? " is-bad" : ""}`}>{value}</span>
		</div>
	);
	return (
		<div className="mwh msg-page">
			<div className="mwh-title">
				<h2 title={detail.name}>
					<NameMark tone={tone}>{detail.name}</NameMark>
				</h2>
			</div>
			<p className="m-sub">
				{tone === "alarm" ? "Stopped at" : "Live at"} block{" "}
				{detail.lastProcessedBlock.toLocaleString("en-US")} · v{detail.version}
			</p>
			<div className="mwh-facts">
				{fact(
					"Behind",
					detail.status === "reindexing"
						? `Reindexing · ${blocksLabel(detail.sync.blocksRemaining)}`
						: blocksLabel(detail.sync.blocksRemaining),
				)}
				{fact("Rows", groupDigits(String(totalRows)))}
				{fact(
					"Errors",
					errors24h === null ? "–" : errors24h.toLocaleString("en-US"),
					(errors24h ?? 0) > 0,
				)}
				{fact(
					"Storage",
					detail.storageBytes === undefined
						? "–"
						: formatBytes(detail.storageBytes),
				)}
			</div>

			{top ? (
				<WhatsHappening
					compact
					insight={top}
					extra={<HandlerErrorsPanel groups={errors.slice(0, 1)} now={now} />}
				/>
			) : null}

			<div className="mwh-chart">
				{health ? (
					<RowsWrittenPanel hours={health.hours} range="24h" />
				) : (
					<ChartSkeleton height={CHART_SKELETON_HEIGHT} />
				)}
			</div>

			<div className="mwh-sec">
				<b>Tables</b>
			</div>
			{tables.length === 0 ? (
				<p className="m-sub">This subgraph has no tables yet.</p>
			) : (
				<ul className="mwh-group msg-tables">
					{tables.map(([name, info]) => (
						<li key={name} className="mwh-kv">
							<span className="mwh-mono">{name}</span>
							<span>
								{groupDigits(String(info.rowCount))}{" "}
								{info.rowCount === 1 ? "row" : "rows"}
							</span>
						</li>
					))}
				</ul>
			)}
			{firstTable ? (
				<NewestRowBlock name={detail.name} table={firstTable} />
			) : null}
		</div>
	);
}
