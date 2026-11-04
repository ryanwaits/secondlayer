"use client";

import { ChartSkeleton } from "@/components/charts/chart-skeleton";
import {
	HeatStrip,
	HeatStripSkeleton,
} from "@/components/dashboard/charts/heat-strip";
import { HourRibbon } from "@/components/dashboard/charts/hour-ribbon";
import { Sparkline } from "@/components/dashboard/charts/sparkline";
import { ActionableInsights } from "@/components/dashboard/insight/insight-actions";
import {
	ResourceRow,
	ResourceRowHead,
	type ResourceRowLabels,
} from "@/components/dashboard/shell/resource-row";
import { StatusSentence } from "@/components/dashboard/shell/status-sentence";
import { useCompact } from "@/components/mobile/use-compact";
import { alignToWindow } from "@/lib/dashboard-charts";
import type { IndexView } from "@/lib/index-view";
import type { Insight } from "@/lib/insights";
import {
	forAccountRules,
	forResource,
	useInsights,
} from "@/lib/insights-store";
import {
	groupDigits,
	handlerErrors24h,
	stateLine,
	subgraphTone,
} from "@/lib/subgraph-view";
import {
	type SubgraphHealthData,
	type SubgraphListItem,
	type SubgraphsResult,
	type SubgraphsSeed,
	listSeed,
	poll,
	refreshListAndHealth,
	useSubgraphsCache,
} from "@/lib/subgraphs-store";
import { flagClass } from "@/lib/tone";
import { useEffect, useState } from "react";
import {
	IndexList,
	RowName,
	RowShell,
	RowStats,
	RowWhy,
} from "../index-rows/index-list";
import {
	type RowStatus,
	SUBGRAPH_GROUP_LABELS,
	subgraphStatus,
	subgraphWhyLine,
} from "../index-rows/status";
import { insightRowState } from "../webhooks/rows";
import { ageShort } from "../webhooks/view";
import { SubgraphsCompactList } from "./compact-list";
import { SubgraphSheet } from "./compact-sheet";
import { SubgraphsEmptyState } from "./empty-state";

/** The list and each subgraph's hourly health refresh this often while the
 *  tab is visible. */
const LIST_POLL_MS = 30_000;
const HOUR_MS = 3_600_000;

export type ListNotice =
	| { kind: "starting" }
	| { kind: "error"; message: string };

/** What a list read means for the page: the notice to show, `null` for none,
 *  or `undefined` to leave the notice as it is. */
function noticeFor(
	res: SubgraphsResult<SubgraphListItem[]>,
): ListNotice | null | undefined {
	if (res.kind === "ok") return null;
	if (res.kind === "starting") return { kind: "starting" };
	if (res.kind === "rate_limited") return undefined;
	return {
		kind: "error",
		message:
			res.kind === "error" ? res.message : "Couldn't load your subgraphs.",
	};
}

/** Polls the list and its hourly health. A notice shows only while there is
 *  nothing cached to display. A page that opened with the server's read
 *  (`initial`) waits a full interval for the first poll, unless the read failed
 *  or some subgraph came without its health. */
export function useSubgraphsPoll(
	initial?: SubgraphsResult<SubgraphListItem[]>,
): ListNotice | null {
	const [notice, setNotice] = useState<ListNotice | null>(
		initial ? (noticeFor(initial) ?? null) : null,
	);
	const complete =
		initial?.kind === "ok" && initial.data.every((s) => s.health !== undefined);
	useEffect(
		() =>
			poll(
				async () => {
					const res = await refreshListAndHealth();
					const next = noticeFor(res);
					if (next !== undefined) setNotice(next);
					return res.kind === "starting" || res.kind === "rate_limited"
						? { retryAfterMs: res.retryAfter * 1000 }
						: {};
				},
				LIST_POLL_MS,
				{ immediate: !complete },
			),
		[complete],
	);
	return notice;
}

function SubgraphRow({
	item,
	health,
	insights,
}: {
	item: SubgraphListItem;
	health: SubgraphHealthData | undefined;
	/** Ranked insights about this subgraph. */
	insights: readonly Insight[];
}) {
	const errors24h = handlerErrors24h(health);
	const points = health?.hours.slice(-24).map((hour) => hour.rowsWritten) ?? [];
	const rows = item.totalRows ?? 0;
	const top = insights[0];
	const insightState = top ? insightRowState(top) : null;
	const tone = insightState?.tone ?? subgraphTone(item.status, errors24h);
	const flag = flagClass(tone);
	const line = stateLine(
		item.blocksRemaining ?? 0,
		rows,
		errors24h,
		item.status,
	);
	return (
		<ResourceRow
			href={`/account/subgraphs/${encodeURIComponent(item.name)}`}
			name={item.name}
			nameTitle={item.name}
			tone={tone}
			state={insightState ? insightState.text : line}
			spark={
				points.length > 1 ? (
					<Sparkline
						points={points}
						title={`${item.name}, rows written per hour, last 24 hours`}
						tone={flag ?? undefined}
					/>
				) : null
			}
			count={`≈${groupDigits(String(rows))}`}
			age={ageShort(item.updatedAt ?? null)}
		/>
	);
}

/** One resource row per subgraph: lag, rows and errors (or its worst
 *  insight), a 24-hour sparkline of rows written, the row count and how long
 *  ago it last wrote. `head` puts a column header of its own above them, for
 *  a table that has other rows above (the Overview's webhooks). */
export function SubgraphRows({
	items,
	health,
	insights = [],
	head,
}: {
	items: readonly SubgraphListItem[];
	health: Record<string, SubgraphHealthData | undefined>;
	/** Every insight the server holds; each row picks its own by name. */
	insights?: readonly Insight[];
	head?: ResourceRowLabels;
}) {
	return (
		<>
			{head ? (
				<ResourceRowHead labels={head} className="ov-group-head" />
			) : null}
			{items.map((item) => (
				<SubgraphRow
					key={item.name}
					item={item}
					health={health[item.name]}
					insights={forResource(insights, "subgraph", item.name)}
				/>
			))}
		</>
	);
}

const healthByName = (
	health: ReturnType<typeof useSubgraphsCache>["health"],
): Record<string, SubgraphHealthData | undefined> =>
	Object.fromEntries(
		Object.entries(health).map(([name, entry]) => [name, entry?.data]),
	);

/** The Overview's subgraph rows, read from the cache the Overview's own
 *  `useSubgraphsPoll` fills. Quiet until the list has loaded, and nothing at
 *  all when the account has no subgraphs. */
export function OverviewSubgraphsRows({
	head,
	seed,
}: {
	head?: ResourceRowLabels;
	/** What the server read, so the rows are in the HTML. */
	seed?: SubgraphsSeed;
}) {
	const { list, health } = useSubgraphsCache(seed);
	const { data: insights } = useInsights();
	if (!list || list.data.length === 0) return null;
	return (
		<SubgraphRows
			items={list.data}
			health={healthByName(health)}
			insights={insights}
			head={head}
		/>
	);
}

export interface SubgraphsListBodyProps {
	/** Null until the first list has loaded. */
	items: readonly SubgraphListItem[] | null;
	health: Record<string, SubgraphHealthData | undefined>;
	notice: ListNotice | null;
	insights?: readonly Insight[];
	/** Account-level insights about this page (the stack not answering). */
	pageInsights?: readonly Insight[];
	/** The view the visitor left this page in. Defaults to Rows. */
	initialView?: IndexView;
}

/** The page insight sits above every state, so it shows even when the list can't load. */
export function SubgraphsListBody({
	pageInsights = [],
	...props
}: SubgraphsListBodyProps) {
	return (
		<>
			<div className="wl-head">
				<h1>Subgraphs</h1>
				<p>
					Your own tables of chain data, each with its own API. You write them
					in TypeScript and deploy them with <code>sl subgraphs</code>.
				</p>
			</div>
			<ActionableInsights insights={pageInsights} />
			<SubgraphsListContent {...props} />
		</>
	);
}

/** A subgraph as the index shows it, with its week on the page's shared timeline. */
interface SubgraphIndexRow {
	item: SubgraphListItem;
	status: RowStatus;
	why: string | null;
	/** Null until the subgraph's health has loaded. */
	cells: { n: number; f: number }[] | null;
}

/** The newest hour any subgraph has health for: the one end every strip aligns to. */
function sharedEndHour(
	health: Record<string, SubgraphHealthData | undefined>,
): string | null {
	let end: string | null = null;
	let endMs = Number.NEGATIVE_INFINITY;
	for (const entry of Object.values(health)) {
		const hour = entry?.hours.at(-1)?.hour;
		const ms = hour ? Date.parse(hour) : Number.NaN;
		if (hour && ms > endMs) {
			end = hour;
			endMs = ms;
		}
	}
	return end;
}

function indexRows(
	items: readonly SubgraphListItem[],
	health: Record<string, SubgraphHealthData | undefined>,
	insights: readonly Insight[],
	endHour: string | null,
): SubgraphIndexRow[] {
	return items.map((item) => {
		const data = health[item.name];
		const top = forResource(insights, "subgraph", item.name)[0];
		const errors24h = handlerErrors24h(data);
		return {
			item,
			status: subgraphStatus(item, errors24h, top),
			why: subgraphWhyLine(item.name, errors24h, top),
			cells:
				data && endHour
					? alignToWindow(
							data.hours.map((h) => ({
								hour: h.hour,
								n: h.rowsWritten,
								f: h.errors,
							})),
							endHour,
						)
					: null,
		};
	});
}

const UNITS = { n: "rows written", f: "handler errors" };
const count = (n: number) => n.toLocaleString("en-US");

/** One index row: name, what needs a look and what flows where, three numbers,
 *  and seven days of rows written as a heat grid or a ribbon beside it. */
function SubgraphListRow({
	row,
	now,
	view,
	isLast,
}: {
	row: SubgraphIndexRow;
	now: number | null;
	view: IndexView;
	/** The last row carries the hour axis the others leave out. */
	isLast: boolean;
}) {
	const { item, status, why, cells } = row;
	const tables = item.tables.length;
	const href = `/account/subgraphs/${encodeURIComponent(item.name)}`;
	const tone = status.group === "hi" ? "att" : undefined;
	const label = `${item.name}, rows written per hour, last 7 days`;
	const errors = cells ? cells.reduce((total, c) => total + c.f, 0) : null;
	const rows = groupDigits(String(item.totalRows ?? 0));
	const name = <RowName name={item.name} status={status} />;
	const route = (
		<span className="ix-route">
			chain events →{" "}
			<b>
				{tables} {tables === 1 ? "table" : "tables"}
			</b>
		</span>
	);
	const whyLine = why ? <RowWhy text={why} group={status.group} /> : null;
	const strip =
		cells && now !== null ? (
			view === "ribbon" ? (
				<HourRibbon
					hours={cells}
					now={now}
					label={label}
					units={UNITS}
					tone={tone}
				/>
			) : (
				<HeatStrip
					hours={cells}
					now={now}
					label={label}
					units={UNITS}
					tone={tone}
					hourAxis={isLast}
				/>
			)
		) : view === "ribbon" ? (
			<div className="ix-strip pending" aria-hidden="true" />
		) : (
			<HeatStripSkeleton hourAxis={isLast} />
		);

	if (view === "ribbon") {
		return (
			<RowShell
				href={href}
				main={
					<>
						{name}
						{whyLine ?? route}
					</>
				}
			>
				{strip}
				<span className="ix-num">
					{rows}
					{errors ? <small>{count(errors)} errors</small> : null}
				</span>
				<span className="ix-ago">{ageShort(item.updatedAt ?? null)}</span>
			</RowShell>
		);
	}
	return (
		<RowShell
			href={href}
			main={
				<>
					{name}
					{whyLine}
					{route}
					<RowStats
						stats={[
							{ value: rows, label: "rows" },
							{
								value: errors === null ? "–" : count(errors),
								label: "errors, 7 days",
								alarm: !!errors,
							},
							{
								value: ageShort(item.updatedAt ?? null),
								label: "since the last write",
							},
						]}
					/>
				</>
			}
		>
			<div>{strip}</div>
		</RowShell>
	);
}

/** The non-empty list, on one timeline: the newest hour any subgraph reports. */
function SubgraphsIndex({
	items,
	health,
	insights,
	initialView,
}: {
	items: readonly SubgraphListItem[];
	health: Record<string, SubgraphHealthData | undefined>;
	insights: readonly Insight[];
	initialView?: IndexView;
}) {
	const endHour = sharedEndHour(health);
	// Mid-hour keeps the newest hour on its own row at midnight.
	const now = endHour ? Date.parse(endHour) + HOUR_MS / 2 : null;
	return (
		<IndexList
			page="subgraphs"
			noun="subgraphs"
			singular="subgraph"
			rows={indexRows(items, health, insights, endHour)}
			rowKey={(row) => row.item.name}
			textOf={({ item }) => `${item.name} ${item.tables.join(" ")}`}
			groupOf={(row) => row.status.group}
			groupLabels={SUBGRAPH_GROUP_LABELS}
			failedLabel="Handler failed"
			numberLabel="Rows"
			now={now}
			initialView={initialView}
			renderRow={(row, { view, isLast }) => (
				<SubgraphListRow row={row} now={now} view={view} isLast={isLast} />
			)}
		/>
	);
}

function SubgraphsListContent({
	items,
	health,
	notice,
	insights = [],
	initialView,
}: Omit<SubgraphsListBodyProps, "pageInsights">) {
	if (items === null) {
		if (notice?.kind === "starting") {
			return (
				<StatusSentence sub="Your account gets its own hosted stack the first time you use subgraphs. This takes about 30 seconds.">
					Starting your hosted stack.
				</StatusSentence>
			);
		}
		if (notice?.kind === "error") {
			return (
				<StatusSentence sub={notice.message}>
					Couldn't load your subgraphs.
				</StatusSentence>
			);
		}
		return <ChartSkeleton height={120} />;
	}
	if (items.length === 0) return <SubgraphsEmptyState />;
	return (
		<SubgraphsIndex
			items={items}
			health={health}
			insights={insights}
			initialView={initialView}
		/>
	);
}

/** /account/subgraphs: the empty state, or one row per subgraph. `initial` is
 *  what the server read for this visit. */
export function SubgraphsListSection({
	initial,
	initialView,
}: {
	initial?: SubgraphsResult<SubgraphListItem[]> | null;
	initialView?: IndexView;
}) {
	const notice = useSubgraphsPoll(initial ?? undefined);
	const { list, health } = useSubgraphsCache(
		initial ? listSeed(initial) : undefined,
	);
	const { data: insights } = useInsights();
	const compact = useCompact();
	const [open, setOpen] = useState<string | null>(null);
	if (compact) {
		return (
			<>
				<SubgraphsCompactList
					items={list?.data ?? null}
					health={healthByName(health)}
					insights={insights}
					notice={notice}
					onOpen={setOpen}
				/>
				{open ? (
					<SubgraphSheet name={open} onClose={() => setOpen(null)} />
				) : null}
			</>
		);
	}
	return (
		<SubgraphsListBody
			items={list?.data ?? null}
			health={healthByName(health)}
			notice={notice}
			insights={insights}
			initialView={initialView}
			pageInsights={forAccountRules(insights, ["stack_unreachable_subgraphs"])}
		/>
	);
}
