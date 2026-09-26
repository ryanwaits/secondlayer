"use client";

import type {
	DeadRow,
	DeliveryRow,
	WebhookActivity,
	WebhookDetail,
	WebhookSummary,
} from "@secondlayer/sdk";
import { useSyncExternalStore } from "react";
import {
	type WebhooksResult,
	getActivity,
	getDead,
	getDeliveries,
	getWebhook,
	listWebhooks,
} from "./webhooks-data";

/**
 * The webhooks list/detail store, modeled on `account-data.ts`: one
 * module-level `state`, `set(patch)`, `subscribe`, `useWebhooksCache()` via
 * `useSyncExternalStore`. Rows in this cache are what the list and detail
 * pages render immediately on every navigation and revisit, while a
 * refresher goes and gets the current numbers in the background.
 *
 * A refresher only writes into the cache on `{ kind: "ok" }` — a starting
 * delivery service, a rate limit or a dropped connection never overwrites
 * good data still on screen; the caller gets the raw result back to decide
 * what notice (if any) to show.
 */

export type CacheEntry<T> = { data: T; at: number } | undefined;

type State = {
	list: CacheEntry<WebhookSummary[]>;
	detail: Record<string, CacheEntry<WebhookDetail>>;
	deliveries: Record<string, CacheEntry<DeliveryRow[]>>;
	dead: Record<string, CacheEntry<DeadRow[]>>;
	activity: Record<string, CacheEntry<WebhookActivity>>;
};

const EMPTY: State = {
	list: undefined,
	detail: {},
	deliveries: {},
	dead: {},
	activity: {},
};

let state: State = EMPTY;
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
	state = { ...state, ...patch };
	for (const l of listeners) l();
}

function subscribe(l: () => void) {
	listeners.add(l);
	return () => listeners.delete(l);
}

/** A plain (non-hook) read of the current cache — what `useWebhooksCache`
 *  hands React, and what a refresher or a test reads without a component
 *  around it. */
export function webhooksSnapshot(): State {
	return state;
}

export function useWebhooksCache(): State {
	return useSyncExternalStore(subscribe, webhooksSnapshot, () => EMPTY);
}

/** Forget every cached row on sign-out, same path as `clearAccountData`. */
export function clearWebhooksData(): void {
	state = EMPTY;
	for (const l of listeners) l();
}

/** How long a cached row is worth serving without a fresh call behind it —
 *  `prefetchDetail`'s own dedupe window, not the visible-poll cadence. */
const FRESH_MS = 10_000;

/** Never resolves `not_found` — the list endpoint's 404 always meant "no
 *  webhooks on this account", so it's folded into an empty `ok` below,
 *  never surfaced as its own kind a caller would have to handle. */
export type ListResult = Exclude<
	WebhooksResult<WebhookSummary[]>,
	{ kind: "not_found" }
>;

export async function refreshList(): Promise<ListResult> {
	const res = await listWebhooks();
	if (res.kind === "ok") {
		set({ list: { data: res.data, at: Date.now() } });
		return res;
	}
	if (res.kind === "not_found") {
		set({ list: { data: [], at: Date.now() } });
		return { kind: "ok", data: [] };
	}
	return res;
}

export interface DetailFetch {
	webhook: WebhooksResult<WebhookDetail>;
	deliveries: WebhooksResult<DeliveryRow[]>;
	dead: WebhooksResult<DeadRow[]>;
	/** `null` when this call was told to skip activity (the caller's own
	 *  fast poll already has it covered this round). */
	activity: WebhooksResult<WebhookActivity> | null;
}

/** Fires the detail reads for one webhook at once — none of them wait on the
 *  webhook object first, unlike the old serial `GET /:id` → logs chain. Each
 *  only writes its own slice of the cache on an `ok`, so one endpoint being
 *  slow or rate-limited never blocks or clears the others.
 *
 *  `activity: false` skips that one read entirely — the detail page passes
 *  it while its own faster activity-only poll is already running, so the
 *  two don't both fetch `/activity` on the same tick. */
export async function refreshDetail(
	id: string,
	opts: { activity?: boolean } = {},
): Promise<DetailFetch> {
	const includeActivity = opts.activity ?? true;
	const [webhook, deliveries, dead, activity] = await Promise.all([
		getWebhook(id),
		getDeliveries(id),
		getDead(id),
		includeActivity ? getActivity(id) : Promise.resolve(null),
	]);
	const now = Date.now();
	const patch: Partial<State> = {};
	if (webhook.kind === "ok") {
		patch.detail = { ...state.detail, [id]: { data: webhook.data, at: now } };
	}
	if (deliveries.kind === "ok") {
		patch.deliveries = {
			...state.deliveries,
			[id]: { data: deliveries.data, at: now },
		};
	}
	if (dead.kind === "ok") {
		patch.dead = { ...state.dead, [id]: { data: dead.data, at: now } };
	}
	if (activity && activity.kind === "ok") {
		patch.activity = {
			...state.activity,
			[id]: { data: activity.data, at: now },
		};
	}
	if (Object.keys(patch).length > 0) set(patch);
	return { webhook, deliveries, dead, activity };
}

/** The fast standalone `/activity` poll (5s, while a receiver is down or
 *  events are waiting) — refreshes only that one slice, not the whole
 *  detail bundle, so the catch-up view doesn't re-fetch deliveries/dead on
 *  every tick. */
export async function refreshActivity(
	id: string,
): Promise<WebhooksResult<WebhookActivity>> {
	const res = await getActivity(id);
	if (res.kind === "ok") {
		set({
			activity: { ...state.activity, [id]: { data: res.data, at: Date.now() } },
		});
	}
	return res;
}

const inFlight = new Map<string, Promise<DetailFetch>>();

/** Warm the cache for a row the reader is about to open (a list-row hover or
 *  focus). Deduped against an in-flight request and skipped outright if the
 *  cache is still fresh — a fast pointer sweeping several rows fires at most
 *  one request per row per `FRESH_MS`. */
export function prefetchDetail(id: string): void {
	const entry = state.detail[id];
	if (entry && Date.now() - entry.at < FRESH_MS) return;
	if (inFlight.has(id)) return;
	const p = refreshDetail(id).finally(() => {
		inFlight.delete(id);
	});
	inFlight.set(id, p);
}

/**
 * Calls `run` right away, then again every `intervalMs` for as long as the
 * tab stays visible — paused polls are skipped, not queued, and a return to
 * "visible" fires immediately instead of waiting out the rest of the
 * interval. `run` can shorten its own next wait (e.g. a server's
 * `Retry-After`) by returning `{ retryAfterMs }`; otherwise the fixed
 * interval applies. Guarded for a `document`-less environment (tests, SSR).
 */
export function poll(
	run: () => Promise<{ retryAfterMs?: number } | undefined>,
	intervalMs: number,
): () => void {
	let stopped = false;
	// True while a `run()` from this poll is in flight. A visibility flap
	// (hidden then visible again) during that window must not start a
	// second `tick()` — the in-flight one already reschedules itself when
	// `run()` settles, so racing it here would fork two live loops writing
	// the same `timer` variable.
	let running = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	function isVisible(): boolean {
		return (
			typeof document === "undefined" || document.visibilityState === "visible"
		);
	}

	async function tick() {
		if (stopped) return;
		if (!isVisible()) {
			timer = setTimeout(tick, intervalMs);
			return;
		}
		running = true;
		const result = await run();
		running = false;
		if (stopped) return;
		timer = setTimeout(tick, result?.retryAfterMs ?? intervalMs);
	}

	function onVisibilityChange() {
		if (stopped || running || !isVisible()) return;
		if (timer) clearTimeout(timer);
		tick();
	}

	tick();
	if (typeof document !== "undefined") {
		document.addEventListener("visibilitychange", onVisibilityChange);
	}

	return () => {
		stopped = true;
		if (timer) clearTimeout(timer);
		if (typeof document !== "undefined") {
			document.removeEventListener("visibilitychange", onVisibilityChange);
		}
	};
}
