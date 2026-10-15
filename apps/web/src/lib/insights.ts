/**
 * The insight contract. The insights API serves `Insight` verbatim; change
 * this file and that API together.
 *
 * Severity: "nothing to fix" informational insights (for example "Oct 5-6 was
 * a backfill") map to `recovered`. They get the hollow dot and never auto-open.
 *
 * Series rendering rule (see dashboard/insight/evidence.tsx):
 * - A `series` evidence with any `context` series renders as a context line
 *   chart: the `context` series dashed, then the first `a` series.
 * - Otherwise it renders as bars from the first `a` series. A `mark` series
 *   (same length) marks the indices whose value is > 0; those bars fill
 *   `--ch-mark`.
 */
export type InsightSeverity = "losing" | "will_fail" | "costs" | "recovered";
export type InsightEvidence =
	| {
			kind: "series";
			title: string;
			series: {
				name: string;
				role: "a" | "context" | "mark";
				points: number[];
			}[];
			labels: [number, string][];
			unit?: string;
	  }
	| {
			kind: "table";
			title: string;
			columns: string[];
			rows: (string | number)[][];
			markRow?: number;
	  }
	| {
			kind: "shapes";
			title: string;
			shapes: { code: string; body: string; count: number; isNew: boolean }[];
	  }
	| {
			kind: "timeline";
			title: string;
			steps: { what: string; at: string; note?: string; failed: boolean }[];
	  };
export interface Insight {
	id: string;
	rule: string;
	severity: InsightSeverity;
	impact: number;
	resource: {
		kind: "webhook" | "subgraph" | "account";
		id: string;
		name: string;
	};
	line: string;
	meta?: string;
	lead: string;
	body: string;
	evidence: InsightEvidence[];
	handoff: { prompt: string; commands: string[] };
	how: {
		detector: string;
		facts: [string, string][];
		label?: { cause: string; confidence: number };
	};
	createdAt: string;
	resolvedAt?: string | null;
}
export const SEVERITY_ORDER: Record<InsightSeverity, number> = {
	losing: 0,
	will_fail: 1,
	costs: 2,
	recovered: 3,
};

/** Below this confidence the card names no cause. */
export const CAUSE_CONFIDENCE = 0.85;

/** Severity, then impact (desc), then createdAt (desc). Returns a new array. */
export function rankInsights(list: readonly Insight[]): Insight[] {
	return [...list].sort(
		(a, b) =>
			SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
			b.impact - a.impact ||
			Date.parse(b.createdAt) - Date.parse(a.createdAt),
	);
}

/** Only a top item that is losing events or about to fail opens on its own. */
export function autoOpenId(list: readonly Insight[]): string | null {
	const top = rankInsights(list)[0];
	if (!top) return null;
	return top.severity === "losing" || top.severity === "will_fail"
		? top.id
		: null;
}

/** The labelled cause, or null when confidence is under 0.85. */
export function causeText(how: Insight["how"]): string | null {
	const label = how.label;
	return label && label.confidence >= CAUSE_CONFIDENCE ? label.cause : null;
}

export type SeverityDot = "alarm" | "hi" | "costs" | "idle";

export function severityDot(severity: InsightSeverity): SeverityDot {
	switch (severity) {
		case "losing":
			return "alarm";
		case "will_fail":
			return "hi";
		case "costs":
			return "costs";
		case "recovered":
			return "idle";
	}
}
