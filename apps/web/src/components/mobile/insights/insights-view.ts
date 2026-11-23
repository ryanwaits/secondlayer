import { type Insight, rankInsights } from "@/lib/insights";

export function openList(data: readonly Insight[]): Insight[] {
	return rankInsights(data.filter((i) => i.severity !== "recovered"));
}

export function resolvedList(data: readonly Insight[]): Insight[] {
	return rankInsights(data.filter((i) => i.severity === "recovered"));
}

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

export function isNewInsight(insight: Insight, seenAt: number): boolean {
	return Date.parse(insight.createdAt) > seenAt && !insight.resolvedAt;
}
