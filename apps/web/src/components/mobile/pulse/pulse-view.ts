import { formatUsd } from "@/lib/account-data";
import type { Billing, Caps } from "@/lib/account-data";
import { type Insight, rankInsights } from "@/lib/insights";
import type { WebhooksActivitySummary } from "@/lib/webhooks-data";

/** Insights that need you now: losing or about to fail, worst first. */
export function needsYou(insights: readonly Insight[]): Insight[] {
	return rankInsights(
		insights.filter(
			(i) => i.severity === "losing" || i.severity === "will_fail",
		),
	);
}

const WINDOW = 24;

/** Delivered and failed per hour across all webhooks, for the last 24 hours. */
export function last24(summary: WebhooksActivitySummary | undefined): {
	delivered: number[];
	failed: number[];
	hours: string[];
} {
	if (!summary) return { delivered: [], failed: [], hours: [] };
	const start = Math.max(0, summary.hours.length - WINDOW);
	const hours = summary.hours.slice(start);
	const sum = (pick: "delivered" | "failed") =>
		hours.map((_, i) =>
			summary.webhooks.reduce((a, w) => a + (w[pick][start + i] ?? 0), 0),
		);
	return { delivered: sum("delivered"), failed: sum("failed"), hours };
}

/** Deliveries (delivered + failed) since 00:00 UTC. */
export function todayEvents(
	summary: WebhooksActivitySummary | undefined,
	now: Date,
): number {
	if (!summary) return 0;
	const day = now.toISOString().slice(0, 10);
	let total = 0;
	summary.hours.forEach((hour, i) => {
		if (hour.slice(0, 10) !== day) return;
		for (const w of summary.webhooks) {
			total += (w.delivered[i] ?? 0) + (w.failed[i] ?? 0);
		}
	});
	return total;
}

function capLabel(cents: number): string {
	return Number.isInteger(cents / 100)
		? `$${cents / 100}`
		: `$${(cents / 100).toFixed(2)}`;
}

/** "$40.10 of $50", or "$40.10 · no cap"; null until billing loads. */
export function spendLine(
	billing: Billing | null,
	caps: Caps | null,
): string | null {
	if (!billing) return null;
	const spent = formatUsd(billing.spentThisMonthUsdMicros);
	if (caps?.monthlyCapCents == null) return `${spent} · no cap`;
	return `${spent} of ${capLabel(caps.monthlyCapCents)}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The all-clear line under "All delivering". */
export function healthyLine(
	webhookCount: number,
	subgraphCount: number,
): string {
	return `${plural(webhookCount, "webhook")}, ${plural(subgraphCount, "subgraph")}. Nothing failed in 24 h.`;
}

/** True only once both lists have loaded and both are empty. */
export function isNewAccount(
	webhooks: unknown[] | null,
	subgraphs: unknown[] | null | undefined,
): boolean {
	return (
		webhooks !== null &&
		webhooks.length === 0 &&
		subgraphs != null &&
		subgraphs.length === 0
	);
}

/** "just now", "42s ago", "3 min ago". */
export function updatedLabel(at: number, now: number): string {
	const seconds = Math.max(0, Math.floor((now - at) / 1000));
	if (seconds < 10) return "just now";
	if (seconds < 60) return `${seconds}s ago`;
	return `${Math.floor(seconds / 60)} min ago`;
}
