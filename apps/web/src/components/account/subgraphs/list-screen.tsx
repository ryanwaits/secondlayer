"use client";

import { ChartSkeleton } from "@/components/charts/chart-skeleton";
import { Sparkline } from "@/components/dashboard/charts/sparkline";
import {
	ResourceRow,
	ResourceRowHead,
} from "@/components/dashboard/shell/resource-row";
import { StatusSentence } from "@/components/dashboard/shell/status-sentence";
import {
	groupDigits,
	handlerErrors24h,
	stateLine,
	subgraphTone,
} from "@/lib/subgraph-view";
import {
	type SubgraphHealthData,
	type SubgraphListItem,
	poll,
	refreshHealth,
	refreshList,
	useSubgraphsCache,
} from "@/lib/subgraphs-store";
import { useEffect, useState } from "react";
import { ageShort } from "../webhooks/view";
import { SubgraphsEmptyState } from "./empty-state";

/** The list and each subgraph's 24-hour health refresh this often while the
 *  tab is visible. */
const LIST_POLL_MS = 30_000;

export type ListNotice =
	| { kind: "starting" }
	| { kind: "error"; message: string };

/** Polls the list and, for each subgraph, its hourly health. A notice shows
 *  only while there is nothing cached to display. */
export function useSubgraphsPoll(): ListNotice | null {
	const [notice, setNotice] = useState<ListNotice | null>(null);
	useEffect(
		() =>
			poll(async () => {
				const res = await refreshList();
				if (res.kind === "ok") {
					setNotice(null);
					await Promise.all(res.data.map((s) => refreshHealth(s.name)));
					return {};
				}
				if (res.kind === "starting" || res.kind === "rate_limited") {
					if (res.kind === "starting") setNotice({ kind: "starting" });
					return { retryAfterMs: res.retryAfter * 1000 };
				}
				setNotice({
					kind: "error",
					message:
						res.kind === "error"
							? res.message
							: "Couldn't load your subgraphs.",
				});
				return {};
			}, LIST_POLL_MS),
		[],
	);
	return notice;
}

/** One resource row per subgraph: lag, rows and errors, a 24-hour sparkline
 *  of rows written, the row count and how long ago it last wrote. */
export function SubgraphRows({
	items,
	health,
}: {
	items: readonly SubgraphListItem[];
	health: Record<string, SubgraphHealthData | undefined>;
}) {
	return (
		<>
			{items.map((item) => {
				const h = health[item.name];
				const errors24h = handlerErrors24h(h);
				const points = h?.hours.map((hour) => hour.rowsWritten) ?? [];
				const rows = item.totalRows ?? 0;
				return (
					<ResourceRow
						key={item.name}
						href={`/account/subgraphs/${encodeURIComponent(item.name)}`}
						name={item.name}
						nameTitle={item.name}
						tone={subgraphTone(item.status, errors24h)}
						state={stateLine(
							item.blocksRemaining ?? 0,
							rows,
							errors24h,
							item.status,
						)}
						spark={
							points.length > 1 ? (
								<Sparkline
									points={points}
									title={`${item.name}, rows written per hour, last 24 hours`}
								/>
							) : null
						}
						count={groupDigits(String(rows))}
						age={ageShort(item.updatedAt ?? null)}
					/>
				);
			})}
		</>
	);
}

const healthByName = (
	health: ReturnType<typeof useSubgraphsCache>["health"],
): Record<string, SubgraphHealthData | undefined> =>
	Object.fromEntries(
		Object.entries(health).map(([name, entry]) => [name, entry?.data]),
	);

/** The Overview's subgraph rows. Quiet until the list has loaded, and
 *  nothing at all when the account has no subgraphs. */
export function OverviewSubgraphsRows() {
	useSubgraphsPoll();
	const { list, health } = useSubgraphsCache();
	if (!list || list.data.length === 0) return null;
	return <SubgraphRows items={list.data} health={healthByName(health)} />;
}

export interface SubgraphsListBodyProps {
	/** Null until the first list has loaded. */
	items: readonly SubgraphListItem[] | null;
	health: Record<string, SubgraphHealthData | undefined>;
	notice: ListNotice | null;
}

export function SubgraphsListBody({
	items,
	health,
	notice,
}: SubgraphsListBodyProps) {
	if (items === null) {
		if (notice?.kind === "starting") {
			return (
				<StatusSentence
					tone="idle"
					sub="Your account gets its own hosted stack the first time you use subgraphs. This takes about 30 seconds."
				>
					Starting your hosted stack.
				</StatusSentence>
			);
		}
		if (notice?.kind === "error") {
			return (
				<StatusSentence tone="alarm" sub={notice.message}>
					Couldn't load your subgraphs.
				</StatusSentence>
			);
		}
		return <ChartSkeleton height={120} />;
	}
	if (items.length === 0) return <SubgraphsEmptyState />;

	const failing = items.filter(
		(s) => subgraphTone(s.status, handlerErrors24h(health[s.name])) === "alarm",
	).length;
	const totalRows = items.reduce((sum, s) => sum + (s.totalRows ?? 0), 0);
	const sub = `${items.length} ${items.length === 1 ? "subgraph" : "subgraphs"} · ${groupDigits(String(totalRows))} rows`;
	return (
		<>
			{failing > 0 ? (
				<StatusSentence tone="alarm" sub={sub}>
					{failing} {failing === 1 ? "subgraph needs" : "subgraphs need"}{" "}
					attention.
				</StatusSentence>
			) : (
				<StatusSentence tone="ok" sub={sub}>
					Everything is indexing.
				</StatusSentence>
			)}
			<div className="dash-rows">
				<ResourceRowHead
					labels={["Subgraph", "State", "Last 24h", "Rows", "Last"]}
				/>
				<SubgraphRows items={items} health={health} />
			</div>
		</>
	);
}

/** /account/subgraphs: the empty state, or one row per subgraph. */
export function SubgraphsListSection() {
	const notice = useSubgraphsPoll();
	const { list, health } = useSubgraphsCache();
	return (
		<SubgraphsListBody
			items={list?.data ?? null}
			health={healthByName(health)}
			notice={notice}
		/>
	);
}
