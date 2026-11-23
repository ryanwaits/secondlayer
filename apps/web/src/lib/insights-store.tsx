"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { createEpoch, notifyAll } from "./epoch";
import { type Insight, rankInsights } from "./insights";
import { shared } from "./request-cache";
import { poll } from "./webhooks-store";

type State = {
	status: "idle" | "ok" | "error";
	data: Insight[];
	at: number;
};

const EMPTY: State = { status: "idle", data: [], at: 0 };
let state: State = EMPTY;
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

export function insightsSnapshot(): State {
	return current();
}

const InsightsSeedContext = createContext<readonly Insight[] | null>(null);

export function InsightsSeed({
	insights,
	children,
}: {
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

/** Quiet on purpose: it runs while a component renders, so it must not wake
 *  other subscribers. */
function applySeed(seed: readonly Insight[]): void {
	if (typeof window === "undefined" || appliedSeeds.has(seed)) return;
	appliedSeeds.add(seed);
	state = { status: "ok", data: rankInsights(seed), at: Date.now() };
}

/** The server never writes the module store: it is shared across requests. */
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

export function clearInsights(options: { deferred?: boolean } = {}): void {
	epoch.bump();
	pendingRemovals.clear();
	removedAt.clear();
	state = EMPTY;
	notifyAll(listeners, options.deferred);
}

/** A refresh must not bring one back: not while its call is in flight, and
 *  not if the refresh began before the call settled. */
const pendingRemovals = new Set<string>();
const removedAt = new Map<string, number>();

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

export function forResource(
	data: readonly Insight[],
	kind: Insight["resource"]["kind"],
	id: string,
): Insight[] {
	return rankInsights(
		data.filter((i) => i.resource.kind === kind && i.resource.id === id),
	);
}

export function forAccountRules(
	data: readonly Insight[],
	rules: readonly string[],
): Insight[] {
	return rankInsights(
		data.filter((i) => i.resource.kind === "account" && rules.includes(i.rule)),
	);
}

export function topLine(
	data: readonly Insight[],
	kind: Insight["resource"]["kind"],
	id: string,
): Insight | null {
	return forResource(data, kind, id)[0] ?? null;
}

export function extraCount(
	data: readonly Insight[],
	kind: Insight["resource"]["kind"],
	id: string,
): number {
	return Math.max(0, forResource(data, kind, id).length - 1);
}

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
	} finally {
		pendingRemovals.delete(id);
	}
	if (live()) {
		set({ ...current(), data: rankInsights([...current().data, removed]) });
		void refreshInsights();
	}
	return false;
}

export function dismiss(id: string): Promise<boolean> {
	return removeThenCall(id, "dismiss");
}

export function markExpected(id: string): Promise<boolean> {
	return removeThenCall(id, "expected");
}

export function snooze(id: string, until: Date): Promise<boolean> {
	return removeThenCall(id, "snooze", { until: until.toISOString() });
}

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
	} catch {}
	if (live()) {
		set({
			...current(),
			data: current().data.filter((i) => i.id !== insight.id),
		});
		void refreshInsights();
	}
	return false;
}

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
