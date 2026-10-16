"use client";

import { ChartSkeleton } from "@/components/charts/chart-skeleton";
import { Choice } from "@/components/choice";
import { ActionableInsights } from "@/components/dashboard/insight/insight-actions";
import { Breadcrumb } from "@/components/dashboard/shell/breadcrumb";
import { Skel } from "@/components/dashboard/shell/skel";
import { dotClass } from "@/components/dashboard/shell/status-sentence";
import type { Insight } from "@/lib/insights";
import { forResource, useInsights } from "@/lib/insights-store";
import {
	blocksLabel,
	formatBytes,
	groupDigits,
	handlerErrors24h,
	shortCount,
	subgraphTone,
} from "@/lib/subgraph-view";
import {
	type SubgraphDetailData,
	type SubgraphErrorGroup,
	type SubgraphHealthData,
	poll,
	prefetchFirstPage,
	refreshDetail,
	refreshErrors,
	refreshHealth,
	useSubgraphsCache,
} from "@/lib/subgraphs-store";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DataGrid, firstPageQuery } from "./data-grid";
import {
	BlocksBehindPanel,
	HandlerErrorsPanel,
	RowsWrittenPanel,
} from "./health-panels";
import { SchemaView } from "./schema-view";

const DETAIL_POLL_MS = 10_000;
const HEALTH_POLL_MS = 60_000;

/** Fact cells `SubgraphDetailBody` renders, and the settled page's measured
 *  panel heights at 1440 px (tabs plus a 10-row grid; two health panels). */
const SKELETON_FACTS = 5;
const PANEL_SKELETON_HEIGHT = 545;
const HEALTH_SKELETON_HEIGHT = 206;

export type SubgraphView = "rows" | "schema";

const VIEW_OPTIONS = [
	{ value: "rows", label: "Rows" },
	{ value: "schema", label: "Schema" },
];

const fact = (label: string, value: string) => (
	<div key={label}>
		{label}
		<b>{value}</b>
	</div>
);

export interface SubgraphDetailBodyProps {
	detail: SubgraphDetailData;
	health: SubgraphHealthData | undefined;
	errors: readonly SubgraphErrorGroup[];
	table: string;
	view: SubgraphView;
	/** Insights about this subgraph, ranked by the server. */
	insights?: readonly Insight[];
	onTable: (table: string) => void;
	onView: (view: SubgraphView) => void;
}

/** One subgraph: facts, a tab per table with Rows or Schema, and its health. */
export function SubgraphDetailBody({
	detail,
	health,
	errors,
	table,
	view,
	insights,
	onTable,
	onView,
}: SubgraphDetailBodyProps) {
	const tables = Object.entries(detail.tables);
	const current = detail.tables[table];
	const errors24h = handlerErrors24h(health);
	const totalRows = tables.reduce((sum, [, t]) => sum + t.rowCount, 0);
	return (
		<>
			<Breadcrumb
				parent={{ href: "/account/subgraphs", label: "Subgraphs" }}
				current={detail.name}
			/>
			<header className="wd-head">
				<div className="wd-top">
					<div className="wd-title">
						<h1>
							<span
								className={dotClass(subgraphTone(detail.status, errors24h))}
							/>
							<span className="wd-name">{detail.name}</span>
						</h1>
					</div>
				</div>
				<div className="wd-facts">
					{fact(
						"Behind tip",
						detail.status === "reindexing"
							? `Reindexing · ${blocksLabel(detail.sync.blocksRemaining)} left`
							: blocksLabel(detail.sync.blocksRemaining),
					)}
					{fact("Rows", groupDigits(String(totalRows)))}
					{fact(
						"Handler errors 24h",
						errors24h === null ? "–" : errors24h.toLocaleString("en-US"),
					)}
					{fact(
						"Storage",
						detail.storageBytes === undefined
							? "–"
							: formatBytes(detail.storageBytes),
					)}
					{fact("Version", `v${detail.version}`)}
				</div>
			</header>

			<ActionableInsights insights={insights ?? []} />

			<section className="dash-panel sg-panel" aria-label="Tables">
				<div className="sg-head">
					<nav className="sg-tabs" role="tablist" aria-label="Tables">
						{tables.map(([name, t]) => (
							<button
								key={name}
								type="button"
								role="tab"
								aria-selected={name === table}
								onClick={() => onTable(name)}
							>
								{name}
								<span className="sg-count">{shortCount(t.rowCount)}</span>
							</button>
						))}
					</nav>
					<div className="sg-view">
						<Choice
							name="sg-view"
							size="sm"
							legend="View"
							options={VIEW_OPTIONS}
							value={view}
							onChange={(value) => onView(value as SubgraphView)}
						/>
					</div>
				</div>
				{current ? (
					view === "rows" ? (
						<DataGrid
							key={`${detail.name}/${table}`}
							name={detail.name}
							table={table}
							columns={current.columns}
							rowCount={current.rowCount}
						/>
					) : (
						<SchemaView table={current} />
					)
				) : (
					<p className="wd-faint">This subgraph has no tables yet.</p>
				)}
			</section>

			{health ? (
				<div className="bl-two even sg-health">
					<BlocksBehindPanel hours={health.hours} />
					<RowsWrittenPanel hours={health.hours} />
				</div>
			) : (
				<div className="bl-two even sg-health">
					<ChartSkeleton height={150} />
					<ChartSkeleton height={150} />
				</div>
			)}

			<HandlerErrorsPanel groups={errors} />
		</>
	);
}

/** Stands in for the whole page: breadcrumb, title, facts, the tables panel
 *  and the two health panels, built from the same wrappers and sized to what
 *  a settled page measures (10-row grid at 1440 px), so nothing moves when
 *  the real content lands. */
function DetailSkeleton({ name }: { name: string }) {
	return (
		<>
			<Breadcrumb
				parent={{ href: "/account/subgraphs", label: "Subgraphs" }}
				current={name}
			/>
			<header className="wd-head">
				<div className="wd-top">
					<div className="wd-title">
						<h1>
							<span className={dotClass("idle")} />
							<span className="wd-name">{name}</span>
						</h1>
					</div>
				</div>
				<div className="wd-facts">
					{Array.from({ length: SKELETON_FACTS }).map((_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton cells
						<Skel key={i} width={92} height={41} />
					))}
				</div>
			</header>
			<section
				className="dash-panel sg-panel"
				aria-label="Loading tables"
				aria-busy="true"
			>
				<ChartSkeleton height={PANEL_SKELETON_HEIGHT} />
			</section>
			<div className="bl-two even sg-health">
				<ChartSkeleton height={HEALTH_SKELETON_HEIGHT} />
				<ChartSkeleton height={HEALTH_SKELETON_HEIGHT} />
			</div>
		</>
	);
}

function NotFound({ name }: { name: string }) {
	return (
		<>
			<Breadcrumb
				parent={{ href: "/account/subgraphs", label: "Subgraphs" }}
				current={name}
			/>
			<p className="sg-missing">
				No subgraph named <b>{name}</b> on this account.{" "}
				<Link href="/account/subgraphs" className="dash-link">
					Back to subgraphs ›
				</Link>
			</p>
		</>
	);
}

/** /account/subgraphs/<name>: loads and refreshes one subgraph. */
export function SubgraphDetailSection({ name }: { name: string }) {
	const { list, detail, health, errors } = useSubgraphsCache();
	const { data: insights } = useInsights();
	const [missing, setMissing] = useState(false);
	const [table, setTable] = useState<string | null>(null);
	const [view, setView] = useState<SubgraphView>("rows");

	// The list already knows the table names, so the grid's rows can load
	// beside the detail instead of after it. Never guess a table name.
	const firstTable = list?.data.find((s) => s.name === name)?.tables[0];
	// biome-ignore lint/correctness/useExhaustiveDependencies: once per subgraph, not per list refresh
	useEffect(() => {
		if (firstTable) void prefetchFirstPage(name, firstTable, firstPageQuery());
	}, [name]);

	useEffect(
		() =>
			poll(async () => {
				const res = await refreshDetail(name);
				if (res.kind === "not_found") setMissing(true);
				else if (res.kind === "ok") setMissing(false);
				return res.kind === "starting" || res.kind === "rate_limited"
					? { retryAfterMs: res.retryAfter * 1000 }
					: {};
			}, DETAIL_POLL_MS),
		[name],
	);

	useEffect(
		() =>
			poll(async () => {
				await refreshHealth(name);
				return {};
			}, HEALTH_POLL_MS),
		[name],
	);

	const data = detail[name]?.data;
	const healthData = health[name]?.data;
	const hasErrors = (handlerErrors24h(healthData) ?? 0) > 0;
	useEffect(
		() =>
			poll(async () => {
				await refreshErrors(name);
				return {};
			}, HEALTH_POLL_MS),
		[name],
	);

	if (!data) {
		if (missing) return <NotFound name={name} />;
		return <DetailSkeleton name={name} />;
	}

	const tableNames = Object.keys(data.tables);
	const selected =
		table && table in data.tables ? table : (tableNames[0] ?? "");
	return (
		<SubgraphDetailBody
			detail={data}
			health={healthData}
			errors={hasErrors ? (errors[name]?.data ?? []) : []}
			table={selected}
			view={view}
			insights={forResource(insights, "subgraph", name)}
			onTable={setTable}
			onView={setView}
		/>
	);
}
