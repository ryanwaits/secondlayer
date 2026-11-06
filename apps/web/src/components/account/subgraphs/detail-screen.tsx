"use client";

import { MissingResource } from "@/components/account/missing-resource";
import { ChartSkeleton } from "@/components/charts/chart-skeleton";
import { Choice } from "@/components/choice";
import { ActionableInsights } from "@/components/dashboard/insight/insight-actions";
import { Breadcrumb } from "@/components/dashboard/shell/breadcrumb";
import { Mark } from "@/components/dashboard/shell/mark";
import { Skel } from "@/components/dashboard/shell/skel";
import { formatDate } from "@/lib/account-data";
import type { Insight } from "@/lib/insights";
import { forResource, useInsights } from "@/lib/insights-store";
import type { Route } from "@/lib/not-found-match";
import type { SubgraphDetailInitial } from "@/lib/server/dashboard-reads";
import {
	formatBytes,
	groupDigits,
	handlerErrors24h,
	isLive,
} from "@/lib/subgraph-view";
import {
	type SubgraphDetailData,
	type SubgraphErrorGroup,
	type SubgraphHealthData,
	type SubgraphSource,
	detailSeed,
	poll,
	refreshDetail,
	refreshErrors,
	refreshHealth,
	refreshSource,
	useSubgraphsCache,
} from "@/lib/subgraphs-store";
import { useEffect, useRef, useState } from "react";
import { HandlerErrorsPanel, RowsWrittenPanel } from "./health-panels";
import { RecentRows } from "./recent-rows";
import type { RecentRowsData } from "./recent-rows-model";
import { TablesSection } from "./tables-section";
import { UseSection } from "./use-section";

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

/** An insight about this subgraph that is still open. */
const hasOpenInsight = (
	insights: readonly Insight[] | undefined,
	rule: string,
) =>
	(insights ?? []).some((i) => i.rule === rule && i.severity !== "recovered");

/** Reindexing or catching up; nothing at the tip. */
function lagFactOf(detail: {
	status: string;
	sync: { blocksRemaining: number };
}): { label: string; value: string } | null {
	const n = detail.sync.blocksRemaining;
	const reindexing = detail.status === "reindexing";
	if (!reindexing && isLive(n)) return null;
	return {
		label: reindexing ? "Reindexing" : "Catching up",
		value: `${groupDigits(String(n))} ${n === 1 ? "block" : "blocks"} to go`,
	};
}

/** A fact cell; `mark` flags the value that is wrong. */
const fact = (label: string, value: string, mark?: "att" | "fail") => (
	<div key={label}>
		{label}
		<b>{mark ? <Mark tone={mark}>{value}</Mark> : value}</b>
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
	/** What the server read for the recent rows and rendered for the tables. */
	initialRows?: RecentRowsData | null;
	initialBlocks?: SubgraphDetailInitial["tableBlocks"];
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
	initialRows,
	initialBlocks,
}: SubgraphDetailBodyProps) {
	// A table opened in Tables, with a counter so reopening it re-applies.
	const [picked, setPicked] = useState<{ table: string; at: number } | null>(
		null,
	);
	const windowHours = health?.hours.slice(-RANGE_HOURS[range]);
	const windowErrors = windowHours ? sum(windowHours.map((h) => h.errors)) : 0;
	const lagFact = lagFactOf(detail);
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
						windowHours ? windowErrors.toLocaleString("en-US") : "–",
						windowErrors > 0 &&
							hasOpenInsight(insights, "subgraph_handler_errors")
							? "fail"
							: undefined,
					)}
					{lagFact !== null
						? fact(
								lagFact.label,
								lagFact.value,
								hasOpenInsight(insights, "subgraph_lag") ? "att" : undefined,
							)
						: null}
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
					initialBlocks={initialBlocks}
					onOpen={(table) => {
						if (table)
							setPicked((prev) => ({ table, at: (prev?.at ?? 0) + 1 }));
					}}
				/>
				<UseSection
					name={detail.name}
					tables={detail.tables}
					selected={picked?.table ?? null}
					selectedAt={picked?.at ?? 0}
				/>
				<RecentRows name={detail.name} initial={initialRows} />
			</div>

			<HandlerErrorsPanel groups={errors} />
		</>
	);
}

/** Stands in for the whole page: breadcrumb, title, facts, the chart and a few
 *  table rows, built from the same wrappers, so nothing moves when the real
 *  content lands. */
export function DetailSkeleton({ name }: { name: string }) {
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

function NotFound({
	name,
	deleted,
	others,
}: {
	name: string;
	deleted: boolean;
	others: Route[] | null;
}) {
	return (
		<>
			<Breadcrumb
				parent={{ href: "/account/subgraphs", label: "Subgraphs" }}
				current={name}
			/>
			<MissingResource
				kind="subgraph"
				id={name}
				deleted={deleted ? name : null}
				listHref="/account/subgraphs"
				others={others}
			/>
		</>
	);
}

/** /account/subgraphs/<name>: loads and refreshes one subgraph. `initial` is
 *  what the server read for this visit; without it the browser loads it all. */
export function SubgraphDetailSection({
	name,
	initial = null,
}: {
	name: string;
	initial?: SubgraphDetailInitial | null;
}) {
	const { list, detail, health, errors, source, missing } = useSubgraphsCache(
		initial ? detailSeed(name, initial) : undefined,
	);
	const { data: insights } = useInsights();
	const [range, setRange] = useState<SubgraphRange>("7d");

	// The server's reads are fresh, so each poll's first tick waits a full
	// interval; one that failed to load retries right away.
	const detailSeeded = initial?.detail.kind === "ok";
	const healthSeeded = useRef(initial?.health.kind === "ok");
	const errorsSeeded = initial?.errors.kind === "ok";
	const sourceSeeded = initial?.source.kind === "ok";

	// biome-ignore lint/correctness/useExhaustiveDependencies: restart only for another subgraph
	useEffect(
		() =>
			poll(
				async () => {
					const res = await refreshDetail(name);
					return res.kind === "starting" || res.kind === "rate_limited"
						? { retryAfterMs: res.retryAfter * 1000 }
						: {};
				},
				DETAIL_POLL_MS,
				{ immediate: !detailSeeded },
			),
		[name],
	);

	// The seed covers the first run only (the week-long range).
	useEffect(() => {
		const immediate = !healthSeeded.current;
		healthSeeded.current = false;
		return poll(
			async () => {
				await refreshHealth(name, RANGE_HOURS[range]);
				return {};
			},
			HEALTH_POLL_MS,
			{ immediate },
		);
	}, [name, range]);

	// The source changes only on a deploy; read it once per visit.
	// biome-ignore lint/correctness/useExhaustiveDependencies: once per subgraph
	useEffect(() => {
		if (!sourceSeeded) void refreshSource(name);
	}, [name]);

	const data = detail[name]?.data;
	const healthData = health[name]?.data;
	const hasErrors = (handlerErrors24h(healthData) ?? 0) > 0;
	// biome-ignore lint/correctness/useExhaustiveDependencies: restart only for another subgraph
	useEffect(
		() =>
			poll(
				async () => {
					await refreshErrors(name);
					return {};
				},
				HEALTH_POLL_MS,
				{ immediate: !errorsSeeded },
			),
		[name],
	);

	if (!data) {
		if (name in missing) {
			return (
				<NotFound
					name={name}
					deleted={missing[name]}
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
			initialRows={initial?.rows}
			initialBlocks={initial?.tableBlocks}
		/>
	);
}
