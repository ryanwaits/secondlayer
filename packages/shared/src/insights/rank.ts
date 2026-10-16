import { type Insight, SEVERITY_ORDER } from "../schemas/insights.ts";

/** Severity, then impact (desc), then createdAt (desc). Returns a new array. */
export function rankInsights(insights: readonly Insight[]): Insight[] {
	return [...insights].sort(
		(a, b) =>
			SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
			b.impact - a.impact ||
			Date.parse(b.createdAt) - Date.parse(a.createdAt),
	);
}
