"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { createEpoch, notifyAll } from "./epoch";
import { type Insight, rankInsights } from "./insights";
import { shared } from "./request-cache";
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
let state: State = EMPTY;
/** Bumped on sign-out: a read that started before it must not fill the next account's store. */
const epoch = createEpoch();
const listeners = new Set<() => void>();

function current(): State {
	return state;
}

function set(next: State) {
	state = next;
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

/** The insights a server render read for this page, if it read any. */
const InsightsSeedContext = createContext<readonly Insight[] | null>(null);

/** Hands a page's server-read insights to every `useInsights()` below it. */
export function InsightsSeed({
	insights,
	children,
}: {
	/** Null when the server couldn't read them: the browser fetches instead. */
	insights: readonly Insight[] | null;
	children?: React.ReactNode;
}) {
	// Apply here, not only in `useInsights`: a reader below a Suspense boundary
	// may hydrate after the frame's effects have run.
	if (insights) applySeed(insights);
	return (
		<InsightsSeedContext.Provider value={insights}>
			{children}
		</InsightsSeedContext.Provider>
	);
}

const appliedSeeds = new WeakSet<object>();
const serverStates = new WeakMap<object, State>();

/** Puts a seed into the client store, once per seed. Quiet on purpose: it runs
 *  while a component renders, so it must not wake other subscribers. */
function applySeed(seed: readonly Insight[]): void {
	if (typeof window === "undefined" || appliedSeeds.has(seed)) return;
	appliedSeeds.add(seed);
	state = { status: "ok", data: rankInsights(seed), at: Date.now() };
}

/** The insights. With a seed from the page, the server render and the
 *  hydration pass read it (so the HTML carries the rows), and the client store
 *  starts from it. The server never writes the module store: it is shared
 *  across requests. */
export function useInsights(): State {
	const seed = useContext(InsightsSeedContext);
	if (seed) applySeed(seed);
	let server = EMPTY;
	if (seed) {
		server = serverStates.get(seed) ?? {
			status: "ok",
			data: rankInsights(seed),
			at: 0,
		};
		serverStates.set(seed, server);
	}
	return useSyncExternalStore(subscribe, insightsSnapshot, () => server);
}

/** Forget everything on sign-out so the next account never sees it. */
export function clearInsights(options: { deferred?: boolean } = {}): void {
	epoch.bump();
	pendingRemovals.clear();
	removedAt.clear();
	state = EMPTY;
	notifyAll(listeners, options.deferred);
}

/** Insights the reader is removing right now (dismiss, expected, snooze),
 *  and when each removal settled with the server (ms). A refresh must not
 *  bring one back: not while its call is in flight, and not if the refresh
 *  began before the call settled. */
const pendingRemovals = new Set<string>();
const removedAt = new Map<string, number>();

/** A refresh's insights without the ones the reader is removing. Pure. */
export function withoutRemovals(
	incoming: readonly Insight[],
	pending: ReadonlySet<string>,
	settledAt: ReadonlyMap<string, number>,
	startedAt: number,
): Insight[] {
	return incoming.filter(
		(i) =>
			!pending.has(i.id) &&
			startedAt > (settledAt.get(i.id) ?? Number.NEGATIVE_INFINITY),
	);
}

export function refreshInsights(): Promise<void> {
	return shared("insights", async () => {
		const startedAt = Date.now();
		const live = epoch.mark();
		try {
			const res = await fetch("/api/insights");
			if (!live()) return;
			if (!res.ok) {
				set({
					...current(),
					status: current().status === "ok" ? "ok" : "error",
				});
				return;
			}
			const body = (await res.json()) as { data: Insight[] };
			if (!live()) return;
			set({
				status: "ok",
				data: rankInsights(
					withoutRemovals(body.data, pendingRemovals, removedAt, startedAt),
				),
				at: Date.now(),
			});
		} catch {
			if (live())
				set({
					...current(),
					status: current().status === "ok" ? "ok" : "error",
				});
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
	const live = epoch.mark();
	set({ ...current(), data: current().data.filter((i) => i.id !== id) });
	pendingRemovals.add(id);
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
		if (res.ok) {
			removedAt.set(id, Date.now());
			return true;
		}
	} catch {
		// Falls through to the rollback.
	} finally {
		pendingRemovals.delete(id);
	}
	if (live()) {
		set({ ...current(), data: rankInsights([...current().data, removed]) });
		void refreshInsights();
	}
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
	removedAt.delete(insight.id);
	const live = epoch.mark();
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
	if (live()) {
		set({
			...current(),
			data: current().data.filter((i) => i.id !== insight.id),
		});
		void refreshInsights();
	}
	return false;
}

/** Refresh now, then every 30 s while the tab is visible. Returns a stop
 *  function. With `immediate: false` the first refresh waits a full interval,
 *  for a page that already carries the insights. */
export function startInsightsPolling(
	options: { immediate?: boolean } = {},
): () => void {
	return poll(
		async () => {
			await refreshInsights();
			return {};
		},
		30_000,
		{ immediate: options.immediate },
	);
}
