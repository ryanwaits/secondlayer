"use client";

import { dotClass } from "@/components/dashboard/shell/status-sentence";
import { type Insight, rankInsights, severityDot } from "@/lib/insights";
import { insightsForWebhook } from "@/lib/webhook-insights";
import { prefetchDetail, useWebhooksCache } from "@/lib/webhooks-store";
import type { WebhookSummary } from "@secondlayer/sdk";
import { type KeyboardEvent, type MouseEvent, useEffect } from "react";
import {
	type HourlySeries,
	type RowState,
	type RowTone,
	listRowState,
} from "./view";

/**
 * What a webhook row shows, from the list, the hourly summary and (once it is
 * cached) the detail bundle. A row whose list-level state is a problem
 * prefetches its detail, so its insights replace the generic line.
 */

export interface WebhookRowModel {
	webhook: WebhookSummary;
	series: HourlySeries | undefined;
	state: RowState;
	/** Ranked, worst first. Empty until the detail bundle has loaded. */
	insights: Insight[];
}

const SEVERITY_TONE: Record<ReturnType<typeof severityDot>, RowTone> = {
	alarm: "alarm",
	hi: "hi",
	costs: "idle",
	idle: "idle",
};

/** The state line for a row: the top insight if there is one, else the
 *  list-level reading. */
export function rowModel(
	webhook: WebhookSummary,
	series: HourlySeries | undefined,
	hours: readonly string[],
	insights: readonly Insight[],
): WebhookRowModel {
	const ranked = rankInsights(insights);
	const top = ranked[0];
	const state: RowState = top
		? {
				tone: SEVERITY_TONE[severityDot(top.severity)],
				text: top.meta ? `${top.line} · ${top.meta}` : top.line,
				bad: top.severity === "losing",
			}
		: listRowState(webhook, series, hours);
	return { webhook, series, state, insights: ranked };
}

/** One model per webhook in the list; null before the list has loaded. */
export function useWebhookRows(): {
	rows: WebhookRowModel[] | null;
	hours: readonly string[];
} {
	const cache = useWebhooksCache();
	const list = cache.list?.data ?? null;
	const hours = cache.summary?.data.hours ?? [];
	const seriesById = new Map(
		(cache.summary?.data.webhooks ?? []).map((w) => [w.id, w] as const),
	);

	const troubled = (list ?? [])
		.filter((w) => {
			const state = listRowState(w, seriesById.get(w.id), hours);
			return state.tone === "alarm" || state.tone === "hi";
		})
		.map((w) => w.id)
		.join(",");
	useEffect(() => {
		for (const id of troubled ? troubled.split(",") : []) prefetchDetail(id);
	}, [troubled]);

	if (!list) return { rows: null, hours };
	return {
		hours,
		rows: list.map((w) =>
			rowModel(
				w,
				seriesById.get(w.id),
				hours,
				insightsForWebhook({
					webhook: cache.detail[w.id]?.data ?? null,
					deliveries: cache.deliveries[w.id]?.data ?? null,
					dead: cache.dead[w.id]?.data ?? null,
					activity: cache.activity[w.id]?.data ?? null,
				}) ?? [],
			),
		),
	};
}

/** Status dot for a tone. */
export function ToneDot({ tone }: { tone: RowTone }) {
	return <span className={dotClass(tone)} />;
}

/**
 * "Why ›" inside a row link: toggles the inline card instead of navigating.
 * A span, because a button cannot sit inside the row's anchor.
 */
export function WhyToggle({
	open,
	onToggle,
}: { open: boolean; onToggle: () => void }) {
	const toggle = (event: MouseEvent | KeyboardEvent) => {
		event.preventDefault();
		event.stopPropagation();
		onToggle();
	};
	return (
		// biome-ignore lint/a11y/useSemanticElements: a button cannot nest inside the row's anchor
		<span
			role="button"
			tabIndex={0}
			aria-expanded={open}
			className="ov-why"
			onClick={toggle}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") toggle(event);
			}}
		>
			{open ? "Hide" : "Why"} ›
		</span>
	);
}

/** The state cell: text, a faint "+N" for more insights, and the Why toggle. */
export function StateCell({
	model,
	open,
	onToggle,
}: {
	model: WebhookRowModel;
	open: boolean;
	onToggle: () => void;
}) {
	const extra = model.insights.length - 1;
	return (
		<span className="ov-state">
			<span className={`ov-state-t${model.state.bad ? " bad" : ""}`}>
				{model.state.text}
			</span>
			{extra > 0 ? (
				<span
					className="ov-more"
					title={`${extra} more ${extra === 1 ? "insight" : "insights"} on this webhook`}
				>
					+{extra}
				</span>
			) : null}
			{model.insights.length > 0 ? (
				<WhyToggle open={open} onToggle={onToggle} />
			) : null}
		</span>
	);
}
