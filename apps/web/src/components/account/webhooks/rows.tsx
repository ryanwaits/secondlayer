"use client";

import { type Insight, rankInsights, severityDot } from "@/lib/insights";
import { forResource, useInsights } from "@/lib/insights-store";
import type { Tone } from "@/lib/tone";
import { type WebhooksSeed, useWebhooksCache } from "@/lib/webhooks-store";
import type { WebhookSummary } from "@secondlayer/sdk";
import { type HourlySeries, type RowState, listRowState } from "./view";

export interface WebhookRowModel {
	webhook: WebhookSummary;
	series: HourlySeries | undefined;
	state: RowState;
	insights: Insight[];
}

const SEVERITY_TONE: Record<ReturnType<typeof severityDot>, Tone> = {
	alarm: "alarm",
	hi: "hi",
	costs: "hi",
	idle: "idle",
};

export function insightRowState(top: Insight): RowState {
	return {
		tone: SEVERITY_TONE[severityDot(top.severity)],
		text: top.meta ? `${top.line} · ${top.meta}` : top.line,
		bad: top.severity === "losing",
	};
}

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

export function useWebhookRows(seed?: WebhooksSeed): {
	rows: WebhookRowModel[] | null;
	hours: readonly string[];
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
