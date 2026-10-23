"use client";

import { ChartSkeleton } from "@/components/charts/chart-skeleton";
import { Choice } from "@/components/choice";
import { Breadcrumb } from "@/components/dashboard/shell/breadcrumb";
import { NameMark } from "@/components/dashboard/shell/name-mark";
import { NameTip } from "@/components/dashboard/shell/name-tip";
import { Skel } from "@/components/dashboard/shell/skel";
import { dotClass } from "@/components/dashboard/shell/status-sentence";
import { type Insight, rankInsights } from "@/lib/insights";
import { forResource, useInsights } from "@/lib/insights-store";
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
	WEEK_HEALTH_HOURS,
	poll,
	refreshDetail,
	refreshErrors,
	refreshHealth,
	useSubgraphsCache,
} from "@/lib/subgraphs-store";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CliLine } from "../webhooks/shared";
import { WhatsHappening } from "../webhooks/whats-happening";
import {
	HandlerErrorsPanel,
	type RowsRange,
	RowsWrittenPanel,
} from "./health-panels";
import { SchemaDrawer } from "./schema-drawer";

const DETAIL_POLL_MS = 10_000;
const HEALTH_POLL_MS = 60_000;

/** Fact cells `SubgraphDetailBody` renders. */
const SKELETON_FACTS = 4;
const CHART_SKELETON_HEIGHT = 206;

const RANGE_OPTIONS = (["24h", "7d"] as const).map((value) => ({
	value,
	label: value,
}));

const fact = (label: string, value: string) => (
	<div key={label}>
		{label}
		<b>{value}</b>
	</div>
);

export interface SubgraphDetailBodyProps {
	detail: SubgraphDetailData;
	/** The last 24 hours: facts, tone and the 24h chart. */
	health: SubgraphHealthData | undefined;
	/** The last 7 days, read when the range is 7d. */
	weekHealth?: SubgraphHealthData;
	errors: readonly SubgraphErrorGroup[];
	/** Insights about this subgraph, ranked by the server. */
	insights?: readonly Insight[];
	range: RowsRange;
	onRange: (range: RowsRange) => void;
	/** The clock the handler-error window is read against; tests pin it. */
	now?: number;
}

/** One subgraph: health facts, what is wrong, rows written, and its tables.
 *  The schema, newest row and query commands open in a drawer. */
export function SubgraphDetailBody({
	detail,
	health,
	weekHealth,
	errors,
	insights,
	range,
	onRange,
	now,
}: SubgraphDetailBodyProps) {
	const [drawer, setDrawer] = useState<{ table: string } | null>(null);
	const tables = Object.entries(detail.tables);
	const errors24h = handlerErrors24h(health);
	const tone = subgraphTone(detail.status, errors24h);
	const totalRows = tables.reduce((sum, [, t]) => sum + t.rowCount, 0);
	const topInsight = rankInsights(insights ?? [])[0];
	const chartHealth = range === "7d" ? weekHealth : health;
	const openDrawer = (table?: string) =>
		setDrawer({ table: table ?? drawer?.table ?? tables[0]?.[0] ?? "" });
	return (
		<>
			<Breadcrumb
				parent={{ href: "/account#subgraphs", label: "Account" }}
				current={detail.name}
			/>
			<header className="wd-head">
				<div className="wd-top">
					<div className="wd-title">
						<h1>
							<NameTip
								tip="Click for schema and details"
								onOpen={() => openDrawer()}
							>
								<NameMark tone={tone}>
									<span className="wd-name">{detail.name}</span>
								</NameMark>
							</NameTip>
						</h1>
					</div>
				</div>
				<p className="wd-lead">
					{tone === "alarm" ? "Stopped at" : "Live at"} block{" "}
					{detail.lastProcessedBlock.toLocaleString("en-US")} · v
					{detail.version}
				</p>
				<div className="wd-facts">
					{fact(
						"Behind tip",
						detail.status === "reindexing"
							? `Reindexing · ${blocksLabel(detail.sync.blocksRemaining)} left`
							: blocksLabel(detail.sync.blocksRemaining),
					)}
					{fact("Rows", groupDigits(String(totalRows)))}
					{fact(
						"Errors · 24h",
						errors24h === null ? "–" : errors24h.toLocaleString("en-US"),
					)}
					{fact(
						"Storage",
						detail.storageBytes === undefined
							? "–"
							: formatBytes(detail.storageBytes),
					)}
				</div>
			</header>

			{topInsight ? (
				<WhatsHappening
					insight={topInsight}
					extra={
						<>
							<HandlerErrorsPanel groups={errors.slice(0, 1)} now={now} />
							{topInsight.handoff.commands.map((command) => (
								<CliLine key={command} command={command} />
							))}
						</>
					}
				/>
			) : null}

			<div className="wd-chart">
				<div className="wd-chart-range">
					<Choice
						name="sg-range"
						size="sm"
						legend="Range"
						options={RANGE_OPTIONS}
						value={range}
						onChange={(value) => onRange(value as RowsRange)}
					/>
				</div>
				{chartHealth ? (
					<RowsWrittenPanel hours={chartHealth.hours} range={range} />
				) : (
					<ChartSkeleton height={CHART_SKELETON_HEIGHT} />
				)}
			</div>

			<section className="wd-def sg-tables" aria-label="Tables">
				<span className="dash-label">Tables</span>
				{tables.length === 0 ? (
					<p className="wd-faint">This subgraph has no tables yet.</p>
				) : (
					<ul>
						{tables.map(([name, info]) => (
							<li key={name}>
								<button
									type="button"
									className="sg-table-row"
									onClick={() => openDrawer(name)}
								>
									<span className="sg-table-name">{name}</span>
									<span className="sg-table-rows">
										<b>{groupDigits(String(info.rowCount))}</b>{" "}
										{info.rowCount === 1 ? "row" : "rows"}
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="wd-def" aria-label="Change it">
				<span className="dash-label">Change it</span>
				<CliLine label="New version" command="sl subgraphs deploy --help" />
				<CliLine
					label="Rebuild tables"
					command={`sl subgraphs reindex ${detail.name}`}
				/>
				<CliLine label="Stop it" command={`sl subgraphs stop ${detail.name}`} />
			</section>

			<SchemaDrawer
				detail={detail}
				table={drawer?.table ?? tables[0]?.[0] ?? ""}
				onTable={(table) => setDrawer({ table })}
				open={drawer !== null}
				onClose={() => setDrawer(null)}
			/>
		</>
	);
}

/** Stands in for the whole page: breadcrumb, title, facts and the chart,
 *  built from the same wrappers so nothing moves when the real content lands. */
function DetailSkeleton({ name }: { name: string }) {
	return (
		<>
			<Breadcrumb
				parent={{ href: "/account#subgraphs", label: "Account" }}
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
			<div className="wd-chart" aria-busy="true">
				<ChartSkeleton height={CHART_SKELETON_HEIGHT} />
			</div>
		</>
	);
}

function NotFound({ name }: { name: string }) {
	return (
		<>
			<Breadcrumb
				parent={{ href: "/account#subgraphs", label: "Account" }}
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
	const { detail, health, healthWeek, errors } = useSubgraphsCache();
	const { data: insights } = useInsights();
	const [missing, setMissing] = useState(false);
	const [range, setRange] = useState<RowsRange>("24h");

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

	// The 24h read always runs: the facts and the tone come from it.
	useEffect(
		() =>
			poll(async () => {
				await refreshHealth(name);
				return {};
			}, HEALTH_POLL_MS),
		[name],
	);

	useEffect(() => {
		if (range !== "7d") return;
		return poll(async () => {
			await refreshHealth(name, WEEK_HEALTH_HOURS);
			return {};
		}, HEALTH_POLL_MS);
	}, [name, range]);

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

	return (
		<SubgraphDetailBody
			detail={data}
			health={healthData}
			weekHealth={healthWeek[name]?.data}
			errors={hasErrors ? (errors[name]?.data ?? []) : []}
			insights={forResource(insights, "subgraph", name)}
			range={range}
			onRange={setRange}
		/>
	);
}
