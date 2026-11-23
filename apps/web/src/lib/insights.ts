/**
 * The insights API serves `Insight` verbatim; change this file and that API
 * together.
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
			facts?: [string, string][];
	  }
	| {
			kind: "response";
			title: string;
			sent: [string, string][];
			excerpt: string | null;
			facts: [string, string][];
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
			kind: "minutes";
			title: string;
			failed: boolean[];
			labels: [string, string];
	  }
	| {
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

export const CAUSE_CONFIDENCE = 0.85;

export function rankInsights(list: readonly Insight[]): Insight[] {
	return [...list].sort(
		(a, b) =>
			SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
			b.impact - a.impact ||
			Date.parse(b.createdAt) - Date.parse(a.createdAt),
	);
}

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

export function rulesHomedAt(href: string): string[] {
	return Object.keys(ACCOUNT_PAGES).filter(
		(rule) => ACCOUNT_PAGES[rule]?.href === href,
	);
}

export function insightHref(insight: Insight): string {
	const { kind, id } = insight.resource;
	if (kind === "webhook") return `/account/webhooks/${encodeURIComponent(id)}`;
	if (kind === "subgraph") {
		return `/account/subgraphs/${encodeURIComponent(id)}`;
	}
	return ACCOUNT_PAGES[insight.rule]?.href ?? "/account";
}

export function insightTargetName(insight: Insight): string {
	if (insight.resource.kind !== "account") return insight.resource.name;
	return ACCOUNT_PAGES[insight.rule]?.name ?? "Overview";
}
