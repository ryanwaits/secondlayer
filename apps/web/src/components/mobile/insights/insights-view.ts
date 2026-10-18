import { type Insight, rankInsights } from "@/lib/insights";

/** Open insights: everything that has not recovered, worst first. */
export function openList(data: readonly Insight[]): Insight[] {
	return rankInsights(data.filter((i) => i.severity !== "recovered"));
}

/** Recovered insights, in rank order. */
export function resolvedList(data: readonly Insight[]): Insight[] {
	return rankInsights(data.filter((i) => i.severity === "recovered"));
}

/** 09:00 tomorrow, browser-local. The one place "until tomorrow" is computed. */
export function snoozeUntil(now: Date): Date {
	return new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate() + 1,
		9,
		0,
		0,
		0,
	);
}

/** Created after the last time the Insights tab was open, and still open. */
export function isNewInsight(insight: Insight, seenAt: number): boolean {
	return Date.parse(insight.createdAt) > seenAt && !insight.resolvedAt;
}
