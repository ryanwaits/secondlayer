"use client";

import { ChartSkeleton } from "@/components/charts/chart-skeleton";
import { Choice } from "@/components/choice";
import { ActionableInsights } from "@/components/dashboard/insight/insight-actions";
import { Breadcrumb } from "@/components/dashboard/shell/breadcrumb";
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
	refreshDetail,
	refreshErrors,
	refreshHealth,
	useSubgraphsCache,
} from "@/lib/subgraphs-store";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DataGrid } from "./data-grid";
import {
	BlocksBehindPanel,
	HandlerErrorsPanel,
	RowsWrittenPanel,
} from "./health-panels";
import { SchemaView } from "./schema-view";

const DETAIL_POLL_MS = 10_000;
const HEALTH_POLL_MS = 60_000;

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
	const { detail, health, errors } = useSubgraphsCache();
	const { data: insights } = useInsights();
	const [missing, setMissing] = useState(false);
	const [table, setTable] = useState<string | null>(null);
	const [view, setView] = useState<SubgraphView>("rows");

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
	useEffect(() => {
		if (!hasErrors) return;
		return poll(async () => {
			await refreshErrors(name);
			return {};
		}, HEALTH_POLL_MS);
	}, [name, hasErrors]);

	if (!data) {
		if (missing) return <NotFound name={name} />;
		return (
			<>
				<Breadcrumb
					parent={{ href: "/account/subgraphs", label: "Subgraphs" }}
					current={name}
				/>
				<div className="wd-title">
					<h1>
						<span className="wd-name">{name}</span>
					</h1>
				</div>
				<ChartSkeleton height={240} />
			</>
		);
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
