"use client";

import {
	createContext,
	useContext,
	useEffect,
	useSyncExternalStore,
} from "react";
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
export function clearInsights(): void {
	state = EMPTY;
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
