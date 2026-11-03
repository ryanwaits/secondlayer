"use client";

import type {
	DeliveryRow,
	WebhookActivity,
	WebhookDetail,
	WebhookSummary,
} from "@secondlayer/sdk";
import { useSyncExternalStore } from "react";
import type { WebhooksResult } from "./dashboard-results";
import { shared } from "./request-cache";
import {
	type WebhooksActivitySummary,
	getActivity,
	getActivitySummary,
	getDeliveries,
	getWebhook,
	listWebhooks,
} from "./webhooks-data";

/**
 * The webhooks list/detail store, modeled on `account-data.ts`: one
 * module-level `state`, `set(patch)`, `subscribe`, `useWebhooksCache()` via
 * `useSyncExternalStore`. A page's server render hands its first reads in as
 * a seed (see `useWebhooksCache`); after that, polls keep the cache current.
 * Nothing is persisted: a reload paints from the server again.
 *
 * A refresher only writes into the cache on `{ kind: "ok" }` — a starting
 * hosted stack, a rate limit or a dropped connection never overwrites
 * good data still on screen; the caller gets the raw result back to decide
 * what notice (if any) to show.
 */

export type CacheEntry<T> = { data: T; at: number } | undefined;

type State = {
	list: CacheEntry<WebhookSummary[]>;
	detail: Record<string, CacheEntry<WebhookDetail>>;
	deliveries: Record<string, CacheEntry<DeliveryRow[]>>;
	activity: Record<string, CacheEntry<WebhookActivity>>;
	/** Hourly delivered/failed for every webhook (heat strips, sparklines). */
	summary: CacheEntry<WebhooksActivitySummary>;
	/** Deliveries for one hour, keyed `${id}:${fromIso}`. */
	deliveriesWindow: Record<string, CacheEntry<DeliveryRow[]>>;
};

const EMPTY: State = {
	list: undefined,
	detail: {},
	deliveries: {},
	activity: {},
	summary: undefined,
	deliveriesWindow: {},
};

let state: State = EMPTY;
const listeners = new Set<() => void>();

function current(): State {
	return state;
}

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

/** What a server render read for the page, in cache shape. */
export type WebhooksSeed = Partial<State>;

const appliedSeeds = new WeakSet<object>();
const serverStates = new WeakMap<object, State>();

/** Puts a seed into the client cache, once per seed. Quiet on purpose: it runs
 *  while a component renders, so it must not wake other subscribers. */
function applySeed(seed: WebhooksSeed): void {
	if (typeof window === "undefined" || appliedSeeds.has(seed)) return;
	appliedSeeds.add(seed);
	state = {
		list: seed.list ?? state.list,
		summary: seed.summary ?? state.summary,
		detail: { ...state.detail, ...seed.detail },
		deliveries: { ...state.deliveries, ...seed.deliveries },
		activity: { ...state.activity, ...seed.activity },
		deliveriesWindow: state.deliveriesWindow,
	};
}

const seedsByInitial = new WeakMap<object, WebhooksSeed>();

/** A server-read detail bundle as a seed: only the reads that came back ok. */
export function detailSeed(id: string, initial: DetailFetch): WebhooksSeed {
	const known = seedsByInitial.get(initial);
	if (known) return known;
	const at = Date.now();
	const { webhook, deliveries, activity } = initial;
	const seed: WebhooksSeed = {
		...(webhook.kind === "ok" && {
			detail: { [id]: { data: webhook.data, at } },
		}),
		...(deliveries.kind === "ok" && {
			deliveries: { [id]: { data: deliveries.data, at } },
		}),
		...(activity?.kind === "ok" && {
			activity: { [id]: { data: activity.data, at } },
		}),
	};
	seedsByInitial.set(initial, seed);
	return seed;
}

/** A server-read list and summary as a seed: only the reads that came back ok. */
export function listSeed(initial: {
	list: WebhooksResult<WebhookSummary[]>;
	summary: WebhooksResult<WebhooksActivitySummary>;
}): WebhooksSeed {
	const known = seedsByInitial.get(initial);
	if (known) return known;
	const at = Date.now();
	const seed: WebhooksSeed = {
		...(initial.list.kind === "ok" && {
			list: { data: initial.list.data, at },
		}),
		...(initial.summary.kind === "ok" && {
			summary: { data: initial.summary.data, at },
		}),
	};
	seedsByInitial.set(initial, seed);
	return seed;
}

/** The cache. With a seed, the server render and the hydration pass read the
 *  seed (so the HTML carries the data), and the client cache starts from it.
 *  The server never writes the module cache: it is shared across requests. */
export function useWebhooksCache(seed?: WebhooksSeed): State {
	if (seed) applySeed(seed);
	let server = EMPTY;
	if (seed) {
		server = serverStates.get(seed) ?? { ...EMPTY, ...seed };
		serverStates.set(seed, server);
	}
	return useSyncExternalStore(subscribe, webhooksSnapshot, () => server);
}

/** Forget every cached row on sign-out, same path as `clearAccountData`. */
export function clearWebhooksData(): void {
	state = EMPTY;
	for (const l of listeners) l();
}

/** Never resolves `not_found` — the list endpoint's 404 always meant "no
 *  webhooks on this account", so it's folded into an empty `ok` below,
 *  never surfaced as its own kind a caller would have to handle. */
export type ListResult = Exclude<
	WebhooksResult<WebhookSummary[]>,
	{ kind: "not_found" }
>;

export function refreshList(
	opts: { wake?: boolean } = {},
): Promise<ListResult> {
	const key = opts.wake ? "webhooks:list:wake" : "webhooks:list";
	return shared(key, async () => {
		const res = await listWebhooks(opts);
		if (res.kind === "ok") {
			set({ list: { data: res.data, at: Date.now() } });
			return res;
		}
		if (res.kind === "not_found") {
			set({ list: { data: [], at: Date.now() } });
			return { kind: "ok", data: [] } as const;
		}
		return res;
	});
}

/** Hourly activity for every webhook. Same rule as the other refreshers:
 *  only an ok result writes. */
export function refreshSummary(): Promise<
	WebhooksResult<WebhooksActivitySummary>
> {
	return shared("webhooks:summary", async () => {
		const res = await getActivitySummary();
		if (res.kind === "ok") {
			set({ summary: { data: res.data, at: Date.now() } });
		}
		return res;
	});
}

/** Hour windows kept per cache; the oldest fall out first. */
export const MAX_WINDOWS = 20;

/** The deliveries inside one window (an hour from a heat square). */
export function refreshDeliveriesWindow(
	id: string,
	window: { from: string; to: string },
): Promise<WebhooksResult<DeliveryRow[]>> {
	const key = `webhooks:window:${id}:${window.from}`;
	return shared(key, async () => {
		const res = await getDeliveries(id, window);
		if (res.kind === "ok") {
			const windows = Object.entries({
				...current().deliveriesWindow,
				[`${id}:${window.from}`]: { data: res.data, at: Date.now() },
			});
			windows.sort(([, a], [, b]) => (b?.at ?? 0) - (a?.at ?? 0));
			set({
				deliveriesWindow: Object.fromEntries(windows.slice(0, MAX_WINDOWS)),
			});
		}
		return res;
	});
}

/** Put a webhook the API just returned (after a rename, pause or resume) in
 *  the cache, so the page and the list agree before the next poll. */
export function applyWebhook(webhook: WebhookDetail): void {
	const patch: Partial<State> = {
		detail: {
			...current().detail,
			[webhook.id]: { data: webhook, at: Date.now() },
		},
	};
	const list = current().list;
	if (list) {
		patch.list = {
			...list,
			data: list.data.map((w) =>
				w.id === webhook.id
					? {
							...w,
							name: webhook.name,
							status: webhook.status,
							circuitOpenedAt: webhook.circuitOpenedAt,
							circuitFailures: webhook.circuitFailures,
						}
					: w,
			),
		};
	}
	set(patch);
}

export interface DetailFetch {
	webhook: WebhooksResult<WebhookDetail>;
	deliveries: WebhooksResult<DeliveryRow[]>;
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
export function refreshDetail(
	id: string,
	opts: { activity?: boolean } = {},
): Promise<DetailFetch> {
	const includeActivity = opts.activity ?? true;
	const key = `webhooks:detail:${id}:${includeActivity}`;
	return shared(key, async () => {
		const [webhook, deliveries, activity] = await Promise.all([
			getWebhook(id),
			getDeliveries(id),
			includeActivity ? getActivity(id) : Promise.resolve(null),
		]);
		const now = Date.now();
		const patch: Partial<State> = {};
		if (webhook.kind === "ok") {
			patch.detail = {
				...current().detail,
				[id]: { data: webhook.data, at: now },
			};
		}
		if (deliveries.kind === "ok") {
			patch.deliveries = {
				...current().deliveries,
				[id]: { data: deliveries.data, at: now },
			};
		}
		if (activity && activity.kind === "ok") {
			patch.activity = {
				...current().activity,
				[id]: { data: activity.data, at: now },
			};
		}
		if (Object.keys(patch).length > 0) {
			set(patch);
		}
		return { webhook, deliveries, activity };
	});
}

/** The fast standalone `/activity` poll (5s, while a receiver is down or
 *  events are waiting) — refreshes only that one slice, not the whole
 *  detail bundle, so the catch-up view doesn't re-fetch deliveries on
 *  every tick. */
export function refreshActivity(
	id: string,
): Promise<WebhooksResult<WebhookActivity>> {
	const key = `webhooks:activity:${id}`;
	return shared(key, async () => {
		const res = await getActivity(id);
		if (res.kind === "ok") {
			set({
				activity: {
					...current().activity,
					[id]: { data: res.data, at: Date.now() },
				},
			});
		}
		return res;
	});
}

/**
 * Calls `run` right away (or, with `immediate: false`, after the first
 * interval: for a screen whose data just came from the server), then again
 * every `intervalMs` for as long as the tab stays visible — paused polls are skipped, not queued, and a return to
 * "visible" fires immediately instead of waiting out the rest of the
 * interval. `run` can shorten its own next wait (e.g. a server's
 * `Retry-After`) by returning `{ retryAfterMs }`; otherwise the fixed
 * interval applies. Guarded for a `document`-less environment (tests, SSR).
 */
export function poll(
	run: () => Promise<{ retryAfterMs?: number } | undefined>,
	intervalMs: number,
	options: { immediate?: boolean } = {},
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

	if (options.immediate === false) timer = setTimeout(tick, intervalMs);
	else tick();
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
