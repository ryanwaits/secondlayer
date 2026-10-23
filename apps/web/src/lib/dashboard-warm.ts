"use client";

import {
	refreshBilling,
	refreshCaps,
	refreshKeys,
	refreshRows,
	refreshUsage,
} from "./account-data";
import { isFresh } from "./request-cache";
import {
	LIST_HEALTH_HOURS,
	listKey,
	refreshListAndHealth,
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
	load(listKey(LIST_HEALTH_HOURS), refreshListAndHealth);
}

/** The account page's reads, which the webhook and subgraph detail pages open with too. */
function warmAccount(): void {
	const month = monthParam(currentUtcMonth());
	load("billing", refreshBilling);
	load("caps", refreshCaps);
	load("keys", refreshKeys);
	load(`usage:${month}`, () => refreshUsage(month));
	load("webhooks:list", () => refreshWebhooks());
	load("webhooks:summary", refreshWebhookSummary);
	warmSubgraphs();
	load("rows", refreshRows);
}

let warmed = false;

/** The account page's reads, once per page load, so a detail page opened from
 *  /account is warm. The Account page reads its own data, so it skips this. */
export function warmDashboard(except?: string): void {
	if (warmed) return;
	warmed = true;
	if (except !== "/account") warmAccount();
}

export function resetWarmForTests(): void {
	warmed = false;
}
