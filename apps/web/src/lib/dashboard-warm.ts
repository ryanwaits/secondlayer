"use client";

import { DASHBOARD_TABS } from "@/components/dashboard/shell/dashboard-tabs";
import {
	refreshAlerts,
	refreshBilling,
	refreshCaps,
	refreshCredits,
	refreshKeys,
	refreshRows,
	refreshUsage,
} from "./account-data";
import { isFresh } from "./request-cache";
import {
	refreshHealth,
	refreshList as refreshSubgraphs,
} from "./subgraphs-store";
import { currentUtcMonth, monthParam } from "./usage";
import {
	refreshSummary as refreshWebhookSummary,
	refreshList as refreshWebhooks,
} from "./webhooks-store";

/** A slice read this recently is not read again by a warm-up. */
const WARM_MAX_AGE_MS = 30_000;

/** Start one read unless its slice is fresh. Results are ignored: a page's own
 *  mount reads own notices and retries when the tab is actually opened. */
function load(key: string, refresh: () => Promise<unknown>): void {
	if (isFresh(key, WARM_MAX_AGE_MS)) return;
	refresh().catch(() => {});
}

function warmSubgraphs(): void {
	if (isFresh("subgraphs:list", WARM_MAX_AGE_MS)) return;
	refreshSubgraphs()
		.then((res) => {
			if (res.kind !== "ok") return;
			for (const s of res.data) {
				load(`subgraphs:health:${s.name}:24`, () => refreshHealth(s.name));
			}
		})
		.catch(() => {});
}

const TABS: Record<string, () => void> = {
	"/account": () => {
		const month = monthParam(currentUtcMonth());
		load("billing", refreshBilling);
		load("caps", refreshCaps);
		load("keys", refreshKeys);
		load(`usage:${month}`, () => refreshUsage(month));
		load("webhooks:list", () => refreshWebhooks());
		load("webhooks:summary", refreshWebhookSummary);
		warmSubgraphs();
		load("rows", refreshRows);
	},
	"/account/rows": () => {
		load("rows", refreshRows);
		load("keys", refreshKeys);
	},
	"/account/webhooks": () => {
		load("webhooks:list", () => refreshWebhooks());
		load("webhooks:summary", refreshWebhookSummary);
		load("keys", refreshKeys);
	},
	"/account/subgraphs": () => {
		warmSubgraphs();
		load("keys", refreshKeys);
	},
	"/account/keys": () => {
		load("keys", refreshKeys);
	},
	"/account/credits": () => {
		const month = monthParam(currentUtcMonth());
		load("billing", refreshBilling);
		load("caps", refreshCaps);
		load("credits", refreshCredits);
		load(`usage:${month}`, () => refreshUsage(month));
		load("alerts", refreshAlerts);
	},
};

/** Start a tab's mount reads so it opens on data. Reads only: never starts a
 *  stopped stack. Unknown hrefs do nothing. */
export function warmTab(href: string): void {
	TABS[href]?.();
}

let warmed = false;

/** Every tab's reads, once per page load: what the other tabs open with. */
export function warmDashboard(except?: string): void {
	if (warmed) return;
	warmed = true;
	for (const tab of DASHBOARD_TABS) {
		if (tab.href !== except) warmTab(tab.href);
	}
}

export function resetWarmForTests(): void {
	warmed = false;
}
