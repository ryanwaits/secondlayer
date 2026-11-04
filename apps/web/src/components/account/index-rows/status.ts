import type { Insight } from "@/lib/insights";
import { groupDigits, isLive, subgraphTone } from "@/lib/subgraph-view";
import type { SubgraphListItem } from "@/lib/subgraphs-store";
import { insightRowState } from "../webhooks/rows";
import type { WebhookRowModel } from "../webhooks/rows";
import { displayStatus, shortenName } from "../webhooks/shared";

/**
 * What an index row says about itself. A healthy row says nothing: `label` is
 * null and the row shows no status at all.
 */
export type StatusGroup = "ok" | "hi" | "alarm" | "idle";
export type RowStatus = { group: StatusGroup; label: string | null };

/** The Status filter's words for each group, per page. */
export const WEBHOOK_GROUP_LABELS: Record<StatusGroup, string> = {
	ok: "Healthy",
	hi: "Needs a look",
	alarm: "Failing",
	idle: "Paused",
};
export const SUBGRAPH_GROUP_LABELS: Record<StatusGroup, string> = {
	ok: "Healthy",
	hi: "Needs a look",
	alarm: "Failing",
	idle: "Catching up",
};

export function webhookStatus(model: WebhookRowModel): RowStatus {
	if (displayStatus(model.webhook) === "paused") {
		return { group: "idle", label: "Paused" };
	}
	if (model.state.tone === "alarm") return { group: "alarm", label: "Failing" };
	if (model.state.tone === "hi") return { group: "hi", label: "Needs a look" };
	return { group: "ok", label: null };
}

const blocksToGo = (n: number) =>
	`${groupDigits(String(n))} ${n === 1 ? "block" : "blocks"} to go`;

/** Lag is progress, never "behind". */
export function subgraphStatus(
	item: SubgraphListItem,
	errors24h: number | null,
	top?: Insight,
): RowStatus {
	const tone = top
		? insightRowState(top).tone
		: subgraphTone(item.status, errors24h);
	if (tone === "alarm") return { group: "alarm", label: "Failing" };
	if (tone === "hi") return { group: "hi", label: "Needs a look" };
	const remaining = item.blocksRemaining ?? 0;
	if (item.status === "reindexing") {
		return {
			group: "idle",
			label:
				remaining > 0 ? `Reindexing · ${blocksToGo(remaining)}` : "Reindexing",
		};
	}
	if (!isLive(remaining)) {
		return { group: "idle", label: `Catching up · ${blocksToGo(remaining)}` };
	}
	if (item.status !== "active") {
		return {
			group: "idle",
			label: item.status.charAt(0).toUpperCase() + item.status.slice(1),
		};
	}
	return { group: "ok", label: null };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** An insight's line often opens with the resource's own name, which the row
 *  already shows. Drops that and capitalizes what is left; a line that doesn't
 *  open with the name comes back unchanged. */
export function trimLeadingName(line: string, name: string): string {
	for (const candidate of new Set([name, shortenName(name)])) {
		const match = new RegExp(`^${escapeRegExp(candidate)}\\s+`).exec(line);
		if (match) {
			const rest = line.slice(match[0].length);
			return rest.charAt(0).toUpperCase() + rest.slice(1);
		}
	}
	return line;
}

/** The one line under a webhook's name: its top insight, else the reading of a
 *  failing or still-counting row. Null when the numbers and chip say it all. */
export function webhookWhyLine(model: WebhookRowModel): string | null {
	const top = model.insights[0];
	if (top) return trimLeadingName(top.line, model.webhook.name);
	const { tone, text } = model.state;
	return tone === "alarm" || text === "Counting…" ? text : null;
}

export function subgraphWhyLine(
	name: string,
	errors24h: number | null,
	top?: Insight,
): string | null {
	if (top) return trimLeadingName(top.line, name);
	if (errors24h && errors24h > 0) {
		return `${errors24h} handler ${errors24h === 1 ? "error" : "errors"} in 24h`;
	}
	return null;
}
