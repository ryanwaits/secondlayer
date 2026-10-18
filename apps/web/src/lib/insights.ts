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
	  }
	| {
			/** One cell per minute, oldest first; `true` = calls failed that minute. */
			kind: "minutes";
			title: string;
			failed: boolean[];
			/** Labels under the first and last cell, e.g. ["17:42", "18:41 now"]. */
			labels: [string, string];
	  }
	| {
			/** Places in the dashboard this insight also concerns, with a count each. */
			kind: "links";
			title: string;
			links: { label: string; href: string; count: number }[];
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

/** The one-word name of a severity, as the phone list shows it. */
export const SEVERITY_WORD: Record<InsightSeverity, string> = {
	losing: "Losing data",
	will_fail: "Will fail",
	costs: "Costs money",
	recovered: "Recovered",
};

const ACCOUNT_PAGES: Record<string, { href: string; name: string }> = {
	server_errors: { href: "/account/rows", name: "Rows" },
	duplicate_reads: { href: "/account/rows", name: "Rows" },
	polling_loop: { href: "/account/rows", name: "Rows" },
	backfill: { href: "/account/rows", name: "Rows" },
	allowance_exhausted: { href: "/account/rows", name: "Rows" },
	key_unused: { href: "/account/keys", name: "Keys" },
	revoked_key_in_use: { href: "/account/keys", name: "Keys" },
	cap_pace: { href: "/account/credits", name: "Billing" },
	credits_runway: { href: "/account/credits", name: "Billing" },
	stack_unreachable_webhooks: { href: "/account/webhooks", name: "Webhooks" },
	stack_unreachable_subgraphs: {
		href: "/account/subgraphs",
		name: "Subgraphs",
	},
};

/** The dashboard page an insight is about. */
export function insightHref(insight: Insight): string {
	const { kind, id } = insight.resource;
	if (kind === "webhook") return `/account/webhooks/${encodeURIComponent(id)}`;
	if (kind === "subgraph") {
		return `/account/subgraphs/${encodeURIComponent(id)}`;
	}
	return ACCOUNT_PAGES[insight.rule]?.href ?? "/account";
}

/** What the sheet's primary button opens: the resource, or the page for an account rule. */
export function insightTargetName(insight: Insight): string {
	if (insight.resource.kind !== "account") return insight.resource.name;
	return ACCOUNT_PAGES[insight.rule]?.name ?? "Overview";
}
