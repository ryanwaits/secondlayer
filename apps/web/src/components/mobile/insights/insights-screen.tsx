"use client";

import { Choice } from "@/components/choice";
import { type Insight, rankInsights } from "@/lib/insights";
import {
	dismiss as storeDismiss,
	restore as storeRestore,
	snooze as storeSnooze,
	useInsights,
} from "@/lib/insights-store";
import { useState } from "react";
import { Toaster, toast } from "sonner";
import { SwipeGroup } from "../swipe-row";
import { InsightRow } from "./insight-row";
import { useInsightSheets } from "./insight-sheet-host";
import {
	isNewInsight,
	openList,
	resolvedList,
	snoozeUntil,
} from "./insights-view";

const SEEN_KEY = "sl.insights.seenAt";

/** Where the screen reads insights and sends actions; the store by default, local state in the Lab. */
export type InsightsSource = {
	ready: boolean;
	data: readonly Insight[];
	snooze: (id: string, until: Date) => Promise<boolean>;
	dismiss: (id: string) => Promise<boolean>;
	restore: (insight: Insight, action: "dismiss" | "snooze") => Promise<boolean>;
};

function useStoreSource(): InsightsSource {
	const { status, data } = useInsights();
	return {
		ready: status === "ok",
		data,
		snooze: storeSnooze,
		dismiss: storeDismiss,
		restore: storeRestore,
	};
}

/** Read once at mount, before the shell stamps the tab as seen. */
export function readSeenAt(): number {
	try {
		return Number(localStorage.getItem(SEEN_KEY)) || 0;
	} catch {
		return 0;
	}
}

type View = "open" | "resolved";

export function EmptyState({ title, text }: { title: string; text: string }) {
	return (
		<div className="m-empty">
			<b>{title}</b>
			<p>{text}</p>
		</div>
	);
}

function emptyFor(view: View, anything: boolean) {
	if (view === "resolved") {
		return (
			<EmptyState
				title="Nothing resolved yet"
				text="Recovered insights stay here for 24 hours."
			/>
		);
	}
	return anything ? (
		<EmptyState title="All clear" text="Nothing on your stack needs a look." />
	) : (
		<EmptyState
			title="Nothing to tell you yet"
			text="When something changes on your stack, like a failing server, a key reading on repeat or spend running ahead, it shows up here, with the likely cause."
		/>
	);
}

/** The phone Insights tab: Open and Resolved, swipe to snooze or finish, tap for the sheet. */
export function InsightsScreen({ source }: { source?: InsightsSource }) {
	const fromStore = useStoreSource();
	const { ready, data, snooze, dismiss, restore } = source ?? fromStore;
	const [view, setView] = useState<View>("open");
	const { open: openSheet, sheets } = useInsightSheets(data);
	const [seenAt] = useState(readSeenAt);

	const open = openList(data);
	const list = view === "open" ? open : resolvedList(data);

	const act = async (
		insight: Insight,
		action: "dismiss" | "snooze",
		message: string,
	) => {
		const ok =
			action === "snooze"
				? await snooze(insight.id, snoozeUntil(new Date()))
				: await dismiss(insight.id);
		if (!ok) {
			toast.error("Couldn't update this insight");
			return;
		}
		toast(message, {
			action: { label: "Undo", onClick: () => void restore(insight, action) },
		});
	};

	return (
		<div className="m-ins">
			<p className="m-sub">
				{open.length > 0 ? `${open.length} open` : "Nothing open"}
			</p>
			<Choice
				name="insights-view"
				size="sm"
				legend="Show"
				options={[
					{ value: "open", label: "Open" },
					{ value: "resolved", label: "Resolved" },
				]}
				value={view}
				onChange={(v) => setView(v === "resolved" ? "resolved" : "open")}
			/>
			{!ready ? null : list.length === 0 ? (
				emptyFor(view, data.length > 0)
			) : (
				<div className="m-ins-list">
					<SwipeGroup>
						{list.map((insight) => (
							<InsightRow
								key={insight.id}
								insight={insight}
								isNew={isNewInsight(insight, seenAt)}
								onOpen={() => openSheet(insight.id)}
								onSnooze={() =>
									void act(insight, "snooze", "Snoozed until tomorrow, 09:00.")
								}
								onDone={() =>
									void act(
										insight,
										"dismiss",
										"Done. Hidden until it fires again.",
									)
								}
							/>
						))}
					</SwipeGroup>
				</div>
			)}
			{sheets}
		</div>
	);
}

/**
 * The screen over in-memory insights with its own toast host, for the Lab:
 * swipe, tap and Undo all work with no server. The app mounts one Toaster in
 * the (www) layout; the Lab sits outside it.
 */
export function LocalInsightsScreen({
	initial,
}: { initial: readonly Insight[] }) {
	const [data, setData] = useState<readonly Insight[]>(initial);
	const source: InsightsSource = {
		ready: true,
		data,
		snooze: async (id) => {
			setData((rows) => rows.filter((i) => i.id !== id));
			return true;
		},
		dismiss: async (id) => {
			setData((rows) => rows.filter((i) => i.id !== id));
			return true;
		},
		restore: async (insight) => {
			setData((rows) =>
				rows.some((i) => i.id === insight.id)
					? rows
					: rankInsights([...rows, insight]),
			);
			return true;
		},
	};
	return (
		<>
			<InsightsScreen source={source} />
			<Toaster
				position="bottom-center"
				toastOptions={{
					unstyled: true,
					classNames: {
						toast: "wh-toast",
						title: "wh-toast-title",
						actionButton: "wh-toast-action",
					},
				}}
			/>
		</>
	);
}
