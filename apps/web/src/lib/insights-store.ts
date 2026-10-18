"use client";

import { useSyncExternalStore } from "react";
import { type Insight, rankInsights } from "./insights";
import { markFresh, shared } from "./request-cache";
import { loadSnapshot, removeSnapshot, saveSnapshot } from "./session-cache";
import { poll } from "./webhooks-store";

/**
 * The ranked insights the server holds for this account, modeled on
 * `account-data.ts`. Ids are the merge route's prefixed ids (`t:` stack,
 * `a:` account); they go back to the action routes as given. A refresh only
 * writes on success, so a failed call never blanks insights already on screen.
 */

type State = {
	status: "idle" | "ok" | "error";
	data: Insight[];
	at: number;
};

const EMPTY: State = { status: "idle", data: [], at: 0 };
const NAME = "insights";
let state: State = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

/** The first client read pulls this tab's last copy, if any. */
function current(): State {
	if (!hydrated && typeof window !== "undefined") {
		hydrated = true;
		const saved = loadSnapshot<State>(NAME);
		if (saved?.status === "ok") state = saved;
	}
	return state;
}

function set(next: State) {
	current();
	state = next;
	if (next.status === "ok") saveSnapshot(NAME, next);
	for (const l of listeners) l();
}

function subscribe(l: () => void) {
	listeners.add(l);
	return () => listeners.delete(l);
}

/** A plain (non-hook) read of the current state, for refreshers and tests. */
export function insightsSnapshot(): State {
	return current();
}

export function useInsights(): State {
	return useSyncExternalStore(subscribe, insightsSnapshot, () => EMPTY);
}

/** Forget everything on sign-out so the next account never sees it. */
export function clearInsights(): void {
	state = EMPTY;
	hydrated = false;
	removeSnapshot(NAME);
	for (const l of listeners) l();
}

export function refreshInsights(): Promise<void> {
	return shared("insights", async () => {
		try {
			const res = await fetch("/api/insights");
			if (!res.ok) {
				set({
					...current(),
					status: current().status === "ok" ? "ok" : "error",
				});
				return;
			}
			const body = (await res.json()) as { data: Insight[] };
			set({ status: "ok", data: rankInsights(body.data), at: Date.now() });
			markFresh("insights");
		} catch {
			set({ ...current(), status: current().status === "ok" ? "ok" : "error" });
		}
	});
}

// ── Selectors (pure) ─────────────────────────────────────────────────────

/** Insights about one resource, ranked. A subgraph's id is its name. */
export function forResource(
	data: readonly Insight[],
	kind: Insight["resource"]["kind"],
	id: string,
): Insight[] {
	return rankInsights(
		data.filter((i) => i.resource.kind === kind && i.resource.id === id),
	);
}

/** Account-level insights for the given rules, ranked. */
export function forAccountRules(
	data: readonly Insight[],
	rules: readonly string[],
): Insight[] {
	return rankInsights(
		data.filter((i) => i.resource.kind === "account" && rules.includes(i.rule)),
	);
}

/** The worst insight on a resource, or null. */
export function topLine(
	data: readonly Insight[],
	kind: Insight["resource"]["kind"],
	id: string,
): Insight | null {
	return forResource(data, kind, id)[0] ?? null;
}

/** How many more insights sit behind the top one. */
export function extraCount(
	data: readonly Insight[],
	kind: Insight["resource"]["kind"],
	id: string,
): number {
	return Math.max(0, forResource(data, kind, id).length - 1);
}

// ── Actions ──────────────────────────────────────────────────────────────

/** Remove optimistically, call the server, and put it back if that fails. */
async function removeThenCall(
	id: string,
	action: "dismiss" | "expected" | "snooze",
	body?: unknown,
): Promise<boolean> {
	const removed = current().data.find((i) => i.id === id);
	if (!removed) return false;
	set({ ...current(), data: current().data.filter((i) => i.id !== id) });
	try {
		const res = await fetch(
			`/api/insights/${encodeURIComponent(id)}/${action}`,
			{
				method: "POST",
				...(body === undefined
					? {}
					: {
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(body),
						}),
			},
		);
		if (res.ok) return true;
	} catch {
		// Falls through to the rollback.
	}
	set({ ...current(), data: rankInsights([...current().data, removed]) });
	void refreshInsights();
	return false;
}

/** "Got it": hide this insight until the rule fires again. */
export function dismiss(id: string): Promise<boolean> {
	return removeThenCall(id, "dismiss");
}

/** "This is expected": stop raising this rule for this resource. */
export function markExpected(id: string): Promise<boolean> {
	return removeThenCall(id, "expected");
}

/** Hide this insight until `until`, even if the rule fires again before then. */
export function snooze(id: string, until: Date): Promise<boolean> {
	return removeThenCall(id, "snooze", { until: until.toISOString() });
}

/** Undo a dismiss or a snooze: put the insight back, then tell the server. */
export async function restore(
	insight: Insight,
	action: "dismiss" | "snooze",
): Promise<boolean> {
	if (!current().data.some((i) => i.id === insight.id)) {
		set({ ...current(), data: rankInsights([...current().data, insight]) });
	}
	try {
		const res = await fetch(
			`/api/insights/${encodeURIComponent(insight.id)}/${action}`,
			{ method: "DELETE" },
		);
		if (res.ok) return true;
	} catch {
		// Falls through to the rollback.
	}
	set({
		...current(),
		data: current().data.filter((i) => i.id !== insight.id),
	});
	void refreshInsights();
	return false;
}

/** Refresh now, then every 30 s while the tab is visible. Returns a stop function. */
export function startInsightsPolling(): () => void {
	return poll(async () => {
		await refreshInsights();
		return {};
	}, 30_000);
}
