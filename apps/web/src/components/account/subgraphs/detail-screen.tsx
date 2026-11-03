"use client";

import { MissingResource } from "@/components/account/missing-resource";
import { ChartSkeleton } from "@/components/charts/chart-skeleton";
import { Choice } from "@/components/choice";
import { ActionableInsights } from "@/components/dashboard/insight/insight-actions";
import { Breadcrumb } from "@/components/dashboard/shell/breadcrumb";
import { Skel } from "@/components/dashboard/shell/skel";
import { dotClass } from "@/components/dashboard/shell/status-sentence";
import { formatDate } from "@/lib/account-data";
import type { Insight } from "@/lib/insights";
import { forResource, useInsights } from "@/lib/insights-store";
import type { Route } from "@/lib/not-found-match";
import {
	blocksLabel,
	formatBytes,
	groupDigits,
	handlerErrors24h,
	subgraphTone,
} from "@/lib/subgraph-view";
import {
	type SubgraphDetailData,
	type SubgraphErrorGroup,
	type SubgraphHealthData,
	type SubgraphSource,
	poll,
	refreshDetail,
	refreshErrors,
	refreshHealth,
	refreshSource,
	useSubgraphsCache,
} from "@/lib/subgraphs-store";
import { useEffect, useState } from "react";
import { HandlerErrorsPanel, RowsWrittenPanel } from "./health-panels";
import { RecentRows } from "./recent-rows";
import { TablesSection } from "./tables-section";

const DETAIL_POLL_MS = 10_000;
const HEALTH_POLL_MS = 60_000;

/** Fact cells `SubgraphDetailBody` renders, and the settled page's measured
 *  chart height. */
const SKELETON_FACTS = 6;
const CHART_SKELETON_HEIGHT = 206;
const SKELETON_TABLE_ROWS = 5;

/** Health stops at seven days. */
export type SubgraphRange = "24h" | "48h" | "7d";
const RANGE_HOURS: Record<SubgraphRange, number> = {
	"24h": 24,
	"48h": 48,
	"7d": 168,
};
const RANGE_OPTIONS = (Object.keys(RANGE_HOURS) as SubgraphRange[]).map(
	(value) => ({ value, label: value }),
);

const fact = (label: string, value: string) => (
	<div key={label}>
		{label}
		<b>{value}</b>
	</div>
);

/** The registry name in "SM3V….sbtc-registry". */
const contractName = (contractId: string): string =>
	contractId.slice(contractId.lastIndexOf(".") + 1);

/** The one contract the sources read, "N contracts" for several, "–" for none. */
function sourceFact(detail: SubgraphDetailData): string {
	const contracts = new Set(
		Object.values(detail.sources ?? {})
			.map((source) => source.contractId)
			.filter((id): id is string => Boolean(id))
			.map(contractName),
	);
	if (contracts.size === 0) return "–";
	if (contracts.size === 1) return [...contracts][0] ?? "–";
	return `${contracts.size} contracts`;
}

const sum = (values: readonly number[]): number =>
	values.reduce((total, value) => total + value, 0);

export interface SubgraphDetailBodyProps {
	detail: SubgraphDetailData;
	health: SubgraphHealthData | undefined;
	errors: readonly SubgraphErrorGroup[];
	/** The authored source; null while it loads or when unavailable. */
	source: SubgraphSource | null;
	range: SubgraphRange;
	/** Insights about this subgraph, ranked by the server. */
	insights?: readonly Insight[];
	onRange: (range: SubgraphRange) => void;
}

/** One subgraph: facts and a chart, what each table writes, and its newest rows. */
export function SubgraphDetailBody({
	detail,
	health,
	errors,
	source,
	range,
	insights,
	onRange,
}: SubgraphDetailBodyProps) {
	const errors24h = handlerErrors24h(health);
	const windowHours = health?.hours.slice(-RANGE_HOURS[range]);
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
					<div className="wd-actions">
						<Choice
							name="sg-range"
							size="sm"
							legend="Range"
							options={RANGE_OPTIONS}
							value={range}
							onChange={(value) => onRange(value as SubgraphRange)}
						/>
					</div>
				</div>
				<div className="wd-facts">
					{fact(
						`Rows written · ${range}`,
						windowHours
							? groupDigits(String(sum(windowHours.map((h) => h.rowsWritten))))
							: "–",
					)}
					{fact(
						`Handler errors · ${range}`,
						windowHours
							? sum(windowHours.map((h) => h.errors)).toLocaleString("en-US")
							: "–",
					)}
					{fact(
						"Behind tip",
						detail.status === "reindexing"
							? `Reindexing · ${blocksLabel(detail.sync.blocksRemaining)} left`
							: blocksLabel(detail.sync.blocksRemaining),
					)}
					{fact(
						"Storage",
						detail.storageBytes === undefined
							? "–"
							: formatBytes(detail.storageBytes),
					)}
					{fact("Source", sourceFact(detail))}
					{fact("Created", formatDate(detail.createdAt))}
				</div>
			</header>

			<ActionableInsights insights={insights ?? []} />

			{windowHours ? (
				<RowsWrittenPanel hours={windowHours} rangeLabel={range} />
			) : (
				<ChartSkeleton height={CHART_SKELETON_HEIGHT} />
			)}

			<div className="wd-stack">
				<TablesSection
					name={detail.name}
					tables={detail.tables}
					sources={detail.sources}
					source={source}
				/>
				<RecentRows name={detail.name} tables={detail.tables} />
			</div>

			<HandlerErrorsPanel groups={errors} />
		</>
	);
}

/** Stands in for the whole page: breadcrumb, title, facts, the chart and a few
 *  table rows, built from the same wrappers, so nothing moves when the real
 *  content lands. */
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
			<ChartSkeleton height={CHART_SKELETON_HEIGHT} />
			<div className="wd-stack" aria-busy="true">
				{Array.from({ length: SKELETON_TABLE_ROWS }).map((_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
					<Skel key={i} width="100%" height={44} />
				))}
			</div>
		</>
	);
}

function NotFound({ name, others }: { name: string; others: Route[] | null }) {
	return (
		<>
			<Breadcrumb
				parent={{ href: "/account/subgraphs", label: "Subgraphs" }}
				current={name}
			/>
			<MissingResource
				kind="subgraph"
				id={name}
				listHref="/account/subgraphs"
				others={others}
			/>
		</>
	);
}

/** /account/subgraphs/<name>: loads and refreshes one subgraph. */
export function SubgraphDetailSection({ name }: { name: string }) {
	const { list, detail, health, errors, source } = useSubgraphsCache();
	const { data: insights } = useInsights();
	const [missing, setMissing] = useState(false);
	const [range, setRange] = useState<SubgraphRange>("7d");

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
				await refreshHealth(name, RANGE_HOURS[range]);
				return {};
			}, HEALTH_POLL_MS),
		[name, range],
	);

	// The source changes only on a deploy; read it once per visit.
	useEffect(() => {
		void refreshSource(name);
	}, [name]);

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
		if (missing) {
			return (
				<NotFound
					name={name}
					others={
						list?.data.map((s) => ({
							href: `/account/subgraphs/${s.name}`,
							title: s.name,
						})) ?? null
					}
				/>
			);
		}
		return <DetailSkeleton name={name} />;
	}

	return (
		<SubgraphDetailBody
			detail={data}
			health={healthData}
			errors={hasErrors ? (errors[name]?.data ?? []) : []}
			source={source[name]?.data ?? null}
			range={range}
			insights={forResource(insights, "subgraph", name)}
			onRange={setRange}
		/>
	);
}
