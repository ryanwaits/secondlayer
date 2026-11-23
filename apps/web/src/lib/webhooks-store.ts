"use client";

import type {
	DeliveryRow,
	WebhookActivity,
	WebhookDetail,
	WebhookSummary,
} from "@secondlayer/sdk";
import { useSyncExternalStore } from "react";
import type { WebhooksResult } from "./dashboard-results";
import { createEpoch, notifyAll } from "./epoch";
import { shared } from "./request-cache";
import {
	type WebhooksActivitySummary,
	getActivity,
	getActivitySummary,
	getDeliveries,
	getWebhook,
	listWebhooks,
	pauseWebhook,
	resumeWebhook,
} from "./webhooks-data";

/**
 * A refresher only writes into the cache on `{ kind: "ok" }` — a starting
 * hosted stack, a rate limit or a dropped connection never overwrites
 * good data still on screen.
 */

export type CacheEntry<T> = { data: T; at: number } | undefined;

export type PauseTarget = "active" | "paused";

export interface PendingPause {
	target: PauseTarget;
	seq: number;
}

const PAUSE_FIELDS = [
	"status",
	"pauseReason",
	"health",
	"circuitOpenedAt",
	"circuitFailures",
] as const;

export interface PauseMarks {
	pending: Record<string, PendingPause>;
	settledAt: Record<string, number>;
}

/**
 * A read must not undo a pause the reader just made: while the write is in
 * flight, or when the read began before the write was applied, the cached
 * pause fields stand and the rest (name, counters, activity) still refresh.
 */
export function mergePolled<T extends { id: string }>(
	cached: T | undefined,
	incoming: T,
	marks: PauseMarks,
	startedAt: number,
): T {
	if (!cached) return incoming;
	const guarded =
		marks.pending[incoming.id] !== undefined ||
		startedAt <= (marks.settledAt[incoming.id] ?? Number.NEGATIVE_INFINITY);
	if (!guarded) return incoming;
	const merged = { ...incoming };
	for (const field of PAUSE_FIELDS) {
		if (field in cached) {
			(merged as Record<string, unknown>)[field] = (
				cached as Record<string, unknown>
			)[field];
		}
	}
	return merged;
}

type State = {
	list: CacheEntry<WebhookSummary[]>;
	detail: Record<string, CacheEntry<WebhookDetail>>;
	deliveries: Record<string, CacheEntry<DeliveryRow[]>>;
	activity: Record<string, CacheEntry<WebhookActivity>>;
	summary: CacheEntry<WebhooksActivitySummary>;
	deliveriesWindow: Record<string, CacheEntry<DeliveryRow[]>>;
	missing: Record<string, string | null>;
} & PauseMarks;

const EMPTY: State = {
	list: undefined,
	detail: {},
	deliveries: {},
	activity: {},
	summary: undefined,
	deliveriesWindow: {},
	missing: {},
	pending: {},
	settledAt: {},
};

let state: State = EMPTY;
const epoch = createEpoch();
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

export function webhooksSnapshot(): State {
	return state;
}

export type WebhooksSeed = Partial<State>;

const appliedSeeds = new WeakSet<object>();
const serverStates = new WeakMap<object, State>();

/** Quiet on purpose: it runs while a component renders, so it must not wake
 *  other subscribers. */
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
		missing: { ...seed.missing, ...state.missing },
		pending: state.pending,
		settledAt: state.settledAt,
	};
}

const seedsByInitial = new WeakMap<object, WebhooksSeed>();

export function detailSeed(id: string, initial: DetailFetch): WebhooksSeed {
	const known = seedsByInitial.get(initial);
	if (known) return known;
	const at = Date.now();
	const { webhook, deliveries, activity } = initial;
	const seed: WebhooksSeed = {
		...(webhook.kind === "ok" && {
			detail: { [id]: { data: webhook.data, at } },
		}),
		...(webhook.kind === "not_found" && { missing: { [id]: null } }),
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

/** The server never writes the module cache: it is shared across requests. */
export function useWebhooksCache(seed?: WebhooksSeed): State {
	if (seed) applySeed(seed);
	let server = EMPTY;
	if (seed) {
		server = serverStates.get(seed) ?? { ...EMPTY, ...seed };
		serverStates.set(seed, server);
	}
	return useSyncExternalStore(subscribe, webhooksSnapshot, () => server);
}

export function clearWebhooksData(options: { deferred?: boolean } = {}): void {
	epoch.bump();
	state = EMPTY;
	notifyAll(listeners, options.deferred);
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
		const startedAt = Date.now();
		const live = epoch.mark();
		const res = await listWebhooks(opts);
		if (res.kind === "ok") {
			const cached = current().list?.data ?? [];
			const data = res.data.map((w) =>
				mergePolled(
					cached.find((c) => c.id === w.id),
					w,
					current(),
					startedAt,
				),
			);
			if (live()) set({ list: { data, at: Date.now() } });
			return { kind: "ok", data } as const;
		}
		if (res.kind === "not_found") {
			if (live()) set({ list: { data: [], at: Date.now() } });
			return { kind: "ok", data: [] } as const;
		}
		return res;
	});
}

export function refreshSummary(): Promise<
	WebhooksResult<WebhooksActivitySummary>
> {
	return shared("webhooks:summary", async () => {
		const live = epoch.mark();
		const res = await getActivitySummary();
		if (res.kind === "ok" && live()) {
			set({ summary: { data: res.data, at: Date.now() } });
		}
		return res;
	});
}

export const MAX_WINDOWS = 20;

export function refreshDeliveriesWindow(
	id: string,
	window: { from: string; to: string },
): Promise<WebhooksResult<DeliveryRow[]>> {
	const key = `webhooks:window:${id}:${window.from}`;
	return shared(key, async () => {
		const live = epoch.mark();
		const res = await getDeliveries(id, window);
		if (res.kind === "ok" && live()) {
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

export function applyWebhook(webhook: WebhookDetail): void {
	set(appliedPatch(webhook));
}

function appliedPatch(webhook: WebhookDetail): Partial<State> {
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
							pauseReason: webhook.pauseReason,
							health: webhook.health,
							circuitOpenedAt: webhook.circuitOpenedAt,
							circuitFailures: webhook.circuitFailures,
						}
					: w,
			),
		};
	}
	return patch;
}

let pauseSeq = 0;

export async function setWebhookPaused(
	id: string,
	target: PauseTarget,
): Promise<WebhooksResult<WebhookDetail>> {
	const seq = ++pauseSeq;
	const live = epoch.mark();
	set({ pending: { ...current().pending, [id]: { target, seq } } });
	const res =
		target === "paused" ? await pauseWebhook(id) : await resumeWebhook(id);
	if (!live()) return res;
	const { [id]: mine, ...others } = current().pending;
	const pending = mine?.seq === seq ? others : current().pending;
	set({
		...(res.kind === "ok" ? appliedPatch(res.data) : {}),
		pending,
		...(res.kind === "ok" && {
			settledAt: { ...current().settledAt, [id]: Date.now() },
		}),
	});
	return res;
}

function forget(id: string): Partial<State> {
	const { list, detail, missing } = current();
	const name =
		missing[id] ??
		detail[id]?.data.name ??
		list?.data.find((w) => w.id === id)?.name ??
		null;
	const { [id]: _gone, ...rest } = detail;
	return {
		missing: { ...missing, [id]: name },
		detail: rest,
		list: list && { ...list, data: list.data.filter((w) => w.id !== id) },
	};
}

export interface DetailFetch {
	webhook: WebhooksResult<WebhookDetail>;
	deliveries: WebhooksResult<DeliveryRow[]>;
	activity: WebhooksResult<WebhookActivity> | null;
}

/** Each read only writes its own slice of the cache on an `ok`, so one
 *  endpoint being slow or rate-limited never blocks or clears the others. */
export function refreshDetail(
	id: string,
	opts: { activity?: boolean } = {},
): Promise<DetailFetch> {
	const includeActivity = opts.activity ?? true;
	const key = `webhooks:detail:${id}:${includeActivity}`;
	return shared(key, async () => {
		const startedAt = Date.now();
		const live = epoch.mark();
		const [webhook, deliveries, activity] = await Promise.all([
			getWebhook(id),
			getDeliveries(id),
			includeActivity ? getActivity(id) : Promise.resolve(null),
		]);
		if (!live()) return { webhook, deliveries, activity };
		const now = Date.now();
		const patch: Partial<State> = {};
		if (webhook.kind === "ok") {
			patch.detail = {
				...current().detail,
				[id]: {
					data: mergePolled(
						current().detail[id]?.data,
						webhook.data,
						current(),
						startedAt,
					),
					at: now,
				},
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
		if (webhook.kind === "not_found") Object.assign(patch, forget(id));
		else if (webhook.kind === "ok" && id in current().missing) {
			const { [id]: _found, ...missing } = current().missing;
			patch.missing = missing;
		}
		if (Object.keys(patch).length > 0) {
			set(patch);
		}
		return { webhook, deliveries, activity };
	});
}

export function refreshActivity(
	id: string,
): Promise<WebhooksResult<WebhookActivity>> {
	const key = `webhooks:activity:${id}`;
	return shared(key, async () => {
		const live = epoch.mark();
		const res = await getActivity(id);
		if (res.kind === "ok" && live()) {
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
