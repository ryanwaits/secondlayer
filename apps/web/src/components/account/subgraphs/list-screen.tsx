"use client";

import { ChartSkeleton } from "@/components/charts/chart-skeleton";
import {
	HeatStrip,
	HeatStripSkeleton,
} from "@/components/dashboard/charts/heat-strip";
import { Legend } from "@/components/dashboard/charts/legend";
import { Sparkline } from "@/components/dashboard/charts/sparkline";
import { ActionableInsights } from "@/components/dashboard/insight/insight-actions";
import {
	ResourceRow,
	ResourceRowHead,
	type ResourceRowLabels,
} from "@/components/dashboard/shell/resource-row";
import { StatusSentence } from "@/components/dashboard/shell/status-sentence";
import { useCompact } from "@/components/mobile/use-compact";
import type { Insight } from "@/lib/insights";
import {
	forAccountRules,
	forResource,
	useInsights,
} from "@/lib/insights-store";
import { useRowLink } from "@/lib/intent-prefetch";
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
import { type Tone, flagClass } from "@/lib/tone";
import Link from "next/link";
import { useEffect, useState } from "react";
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

/** The tone an index row carries: its worst insight, else its own health. */
function listRowTone(
	item: SubgraphListItem,
	health: SubgraphHealthData | undefined,
	insights: readonly Insight[],
): Tone {
	const top = insights[0];
	return top
		? insightRowState(top).tone
		: subgraphTone(item.status, handlerErrors24h(health));
}

/** One index row: name, state and what flows where, with seven days of rows
 *  written as a heat grid beside it. */
function SubgraphListRow({
	item,
	health,
	insights,
}: {
	item: SubgraphListItem;
	health: SubgraphHealthData | undefined;
	insights: readonly Insight[];
}) {
	const top = insights[0];
	const insightState = top ? insightRowState(top) : null;
	const errors24h = handlerErrors24h(health);
	const tone = listRowTone(item, health, insights);
	const text =
		insightState?.text ??
		stateLine(
			item.blocksRemaining ?? 0,
			item.totalRows ?? 0,
			errors24h,
			item.status,
		);
	const last = health?.hours.at(-1)?.hour;
	const tables = item.tables.length;
	const href = `/account/subgraphs/${encodeURIComponent(item.name)}`;
	const row = useRowLink(href);
	return (
		<div className="wl-row link" {...row}>
			<Link href={href} prefetch={false} className="wl-main">
				<span className="dash-row-name">
					<span title={item.name}>{item.name}</span>
				</span>
				<span className={`wl-state${tone === "alarm" ? " bad" : ""}`}>
					{text}
				</span>
				<span className="wl-sub">
					chain events →{" "}
					<b>
						{tables} {tables === 1 ? "table" : "tables"}
					</b>
				</span>
			</Link>
			{health && last ? (
				<HeatStrip
					hours={health.hours.map((h) => ({ n: h.rowsWritten, f: h.errors }))}
					// Mid-hour keeps the newest hour on its own row at midnight.
					now={Date.parse(last) + HOUR_MS / 2}
					label={`${item.name}, rows written per hour, last 7 days`}
					units={{ n: "rows written", f: "handler errors" }}
					tone={tone === "hi" ? "att" : undefined}
				/>
			) : (
				<HeatStripSkeleton />
			)}
		</div>
	);
}

function SubgraphsListContent({
	items,
	health,
	notice,
	insights = [],
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
	const flagged = items.some(
		(item) =>
			listRowTone(
				item,
				health[item.name],
				forResource(insights, "subgraph", item.name),
			) === "hi",
	);

	return (
		<>
			<div className="wl-rows">
				{items.map((item) => (
					<SubgraphListRow
						key={item.name}
						item={item}
						health={health[item.name]}
						insights={forResource(insights, "subgraph", item.name)}
					/>
				))}
			</div>
			<Legend
				items={[
					{
						swatch: "square",
						label: "Rows written that hour, darker is more",
						color: "var(--ch-a)",
					},
					...(flagged
						? [
								{
									swatch: "square" as const,
									label: "Rows written, subgraph needs a look",
									color: "var(--hi)",
								},
							]
						: []),
					{ swatch: "square", label: "Handler failed" },
					{ swatch: "square", label: "Nothing", color: "var(--soft)" },
				]}
			/>
		</>
	);
}

/** /account/subgraphs: the empty state, or one row per subgraph. `initial` is
 *  what the server read for this visit. */
export function SubgraphsListSection({
	initial,
}: {
	initial?: SubgraphsResult<SubgraphListItem[]> | null;
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
			pageInsights={forAccountRules(insights, ["stack_unreachable_subgraphs"])}
		/>
	);
}
