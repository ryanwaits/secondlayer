"use client";

import { type Insight, rankInsights, severityDot } from "@/lib/insights";
import { forResource, useInsights } from "@/lib/insights-store";
import type { Tone } from "@/lib/tone";
import { type WebhooksSeed, useWebhooksCache } from "@/lib/webhooks-store";
import type { WebhookSummary } from "@secondlayer/sdk";
import { type HourlySeries, type RowState, listRowState } from "./view";

/**
 * What a webhook row shows, from the list, the hourly summary and the
 * server's ranked insights. A webhook's top insight replaces the generic
 * list-level line.
 */

export interface WebhookRowModel {
	webhook: WebhookSummary;
	series: HourlySeries | undefined;
	state: RowState;
	/** Ranked, worst first. Empty until the insights have loaded. */
	insights: Insight[];
}

/** Failing and will-fail insights flag the row; a costs insight (the test
 *  endpoint, say) is attention; a recovered one shows nothing. */
const SEVERITY_TONE: Record<ReturnType<typeof severityDot>, Tone> = {
	alarm: "alarm",
	hi: "hi",
	costs: "hi",
	idle: "idle",
};

/** A row's state line from its worst insight. */
export function insightRowState(top: Insight): RowState {
	return {
		tone: SEVERITY_TONE[severityDot(top.severity)],
		text: top.meta ? `${top.line} · ${top.meta}` : top.line,
		bad: top.severity === "losing",
	};
}

/** The state line for a row: the top insight if there is one, else the
 *  list-level reading. */
export function rowModel(
	webhook: WebhookSummary,
	series: HourlySeries | undefined,
	hours: readonly string[],
	insights: readonly Insight[],
	summaryLoaded = true,
): WebhookRowModel {
	const ranked = rankInsights(insights);
	const top = ranked[0];
	const state: RowState = top
		? insightRowState(top)
		: listRowState(webhook, series, hours, !summaryLoaded);
	return { webhook, series, state, insights: ranked };
}

/** One model per webhook in the list; null before the list has loaded. */
export function useWebhookRows(seed?: WebhooksSeed): {
	rows: WebhookRowModel[] | null;
	hours: readonly string[];
	/** The hourly summary has arrived (rows may still lack a series). */
	summaryLoaded: boolean;
} {
	const cache = useWebhooksCache(seed);
	const { data: insights } = useInsights();
	const list = cache.list?.data ?? null;
	const hours = cache.summary?.data.hours ?? [];
	const seriesById = new Map(
		(cache.summary?.data.webhooks ?? []).map((w) => [w.id, w] as const),
	);

	const summaryLoaded = cache.summary !== undefined;

	if (!list) return { rows: null, hours, summaryLoaded };
	return {
		hours,
		summaryLoaded,
		rows: list.map((w) =>
			rowModel(
				w,
				seriesById.get(w.id),
				hours,
				forResource(insights, "webhook", w.id),
				summaryLoaded,
			),
		),
	};
}
