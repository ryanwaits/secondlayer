"use client";

import { useSyncExternalStore } from "react";
import { type WebhooksResult, resultFromResponse } from "./dashboard-results";
import { shared } from "./request-cache";
import { HEALTH_WEEK_HOURS } from "./subgraph-view";

export { poll } from "./webhooks-store";

/**
 * The Subgraphs list/detail store, same shape as `webhooks-store.ts`: one
 * module-level `state`, `useSubgraphsCache()` through `useSyncExternalStore`.
 * Reads go through the dashboard's own read-only `/api/subgraphs/*` proxy.
 * A refresher writes only on `{ kind: "ok" }`, so a starting stack or a rate
 * limit never overwrites good data still on screen.
 *
 * The shapes below are what the tenant API returns today, declared here
 * because the SDK has no types for `/health`, `/errors` or `storageBytes`.
 */

export interface SubgraphListItem {
	name: string;
	version: string;
	status: string;
	lastProcessedBlock: number;
	totalRows?: number;
	totalErrors: number;
	tables: string[];
	blocksRemaining?: number;
	lastError?: string | null;
	updatedAt?: string | null;
	createdAt: string;
	/** Present when the list was requested with `?health=`. */
	health?: SubgraphHealthData;
}

export interface SubgraphColumn {
	type: string;
	nullable?: boolean;
	indexed?: boolean;
	searchable?: boolean;
}

export interface SubgraphTableInfo {
	endpoint: string;
	columns: Record<string, SubgraphColumn>;
	rowCount: number;
	storageBytes?: number;
	indexes?: readonly (readonly string[])[];
	uniqueKeys?: readonly (readonly string[])[];
}

export interface SubgraphSourceInfo {
	type: string;
	contractId?: string;
	topic?: string;
	functionName?: string;
}

/** A subgraph's authored source, as the proxy returns it (no deployed bundle). */
export interface SubgraphSource {
	name: string;
	version: string;
	sourceCode: string | null;
	readOnly: boolean;
	updatedAt: string;
}

export interface SubgraphDetailData {
	name: string;
	version: string;
	status: string;
	lastProcessedBlock: number;
	health: {
		totalProcessed: number;
		totalErrors: number;
		lastError: string | null;
	};
	sync: { status: string; blocksRemaining: number; chainTip: number };
	tables: Record<string, SubgraphTableInfo>;
	sources?: Record<string, SubgraphSourceInfo>;
	storageBytes?: number;
	createdAt: string;
	updatedAt: string;
}

export interface SubgraphHealthHour {
	hour: string;
	lagBlocks: number | null;
	rowsWritten: number;
	errors: number;
	eventsHandled: number;
}

export interface SubgraphHealthData {
	hours: SubgraphHealthHour[];
	errors24h: number;
}

export interface SubgraphErrorGroup {
	message: string;
	frame: string | null;
	eventType: string | null;
	sourceName: string | null;
	count: number;
	sampleTxId: string | null;
	sampleBlockHeight: number | null;
	firstSeen: string;
	lastSeen: string;
}

export interface SubgraphRowsPage {
	rows: Record<string, unknown>[];
	next_cursor: string | null;
	tip?: {
		block_height: number;
		subgraph_height: number;
		blocks_behind: number;
	};
}

export type SubgraphsResult<T> = WebhooksResult<T>;

export type CacheEntry<T> = { data: T; at: number } | undefined;

type State = {
	list: CacheEntry<SubgraphListItem[]>;
	detail: Record<string, CacheEntry<SubgraphDetailData>>;
	health: Record<string, CacheEntry<SubgraphHealthData>>;
	errors: Record<string, CacheEntry<SubgraphErrorGroup[]>>;
	source: Record<string, CacheEntry<SubgraphSource>>;
};

const EMPTY: State = {
	list: undefined,
	detail: {},
	health: {},
	errors: {},
	source: {},
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

export function subgraphsSnapshot(): State {
	return state;
}

/** What a server render read for the page, in cache shape. */
export type SubgraphsSeed = Partial<State>;

const appliedSeeds = new WeakSet<object>();
const serverStates = new WeakMap<object, State>();
const seedsByInitial = new WeakMap<object, SubgraphsSeed>();

/** Puts a seed into the client cache, once per seed. Quiet on purpose: it runs
 *  while a component renders, so it must not wake other subscribers. */
function applySeed(seed: SubgraphsSeed): void {
	if (typeof window === "undefined" || appliedSeeds.has(seed)) return;
	appliedSeeds.add(seed);
	state = {
		list: seed.list ?? state.list,
		detail: { ...state.detail, ...seed.detail },
		health: { ...state.health, ...seed.health },
		errors: { ...state.errors, ...seed.errors },
		source: { ...state.source, ...seed.source },
	};
}

/** The cache. With a seed, the server render and the hydration pass read the
 *  seed (so the HTML carries the data), and the client cache starts from it.
 *  The server never writes the module cache: it is shared across requests. */
export function useSubgraphsCache(seed?: SubgraphsSeed): State {
	if (seed) applySeed(seed);
	let server = EMPTY;
	if (seed) {
		server = serverStates.get(seed) ?? { ...EMPTY, ...seed };
		serverStates.set(seed, server);
	}
	return useSyncExternalStore(subscribe, subgraphsSnapshot, () => server);
}

/** A server-read list (with each item's health) as a seed. */
export function listSeed(
	initial: SubgraphsResult<SubgraphListItem[]>,
): SubgraphsSeed {
	const known = seedsByInitial.get(initial);
	if (known) return known;
	const at = Date.now();
	const seed: SubgraphsSeed =
		initial.kind === "ok"
			? {
					list: { data: initial.data, at },
					health: Object.fromEntries(
						initial.data.flatMap((s) =>
							s.health ? [[s.name, { data: s.health, at }]] : [],
						),
					),
				}
			: {};
	seedsByInitial.set(initial, seed);
	return seed;
}

/** The reads a server render made for one subgraph, as a seed. */
export interface SubgraphDetailReads {
	detail: SubgraphsResult<SubgraphDetailData>;
	health: SubgraphsResult<SubgraphHealthData>;
	errors: SubgraphsResult<SubgraphErrorGroup[]>;
	source: SubgraphsResult<SubgraphSource>;
}

export function detailSeed(
	name: string,
	initial: SubgraphDetailReads,
): SubgraphsSeed {
	const known = seedsByInitial.get(initial);
	if (known) return known;
	const at = Date.now();
	const seed: SubgraphsSeed = {
		...(initial.detail.kind === "ok" && {
			detail: { [name]: { data: initial.detail.data, at } },
		}),
		...(initial.health.kind === "ok" && {
			health: { [name]: { data: initial.health.data, at } },
		}),
		...(initial.errors.kind === "ok" && {
			errors: { [name]: { data: initial.errors.data, at } },
		}),
		...(initial.source.kind === "ok" && {
			source: { [name]: { data: initial.source.data, at } },
		}),
	};
	seedsByInitial.set(initial, seed);
	return seed;
}

/** Forget every cached subgraph on sign-out. */
export function clearSubgraphsData(): void {
	state = EMPTY;
	for (const l of listeners) l();
}

async function request<T>(path: string): Promise<SubgraphsResult<T>> {
	let res: Response;
	try {
		res = await fetch(`/api/subgraphs${path}`);
	} catch {
		return { kind: "error", message: "Couldn't reach the dashboard" };
	}
	let body: unknown = null;
	try {
		body = await res.json();
	} catch {
		// An empty error body falls through to the status-only message.
	}
	return resultFromResponse<T>(res, body);
}

const seg = encodeURIComponent;

/** The request-cache key for a list read; each query shape has its own. */
export const listKey = (health?: number): string =>
	health ? `subgraphs:list:h${health}` : "subgraphs:list";

/** A 404 on the list means the account has no subgraphs (and maybe no stack
 *  yet), so it reads as an empty list, never as `not_found`. With `health`,
 *  the response also carries each subgraph's hourly health for that many
 *  hours; it lands in the health slice in the same write as the list. */
export function refreshList(
	options: { health?: number } = {},
): Promise<
	Exclude<SubgraphsResult<SubgraphListItem[]>, { kind: "not_found" }>
> {
	const key = listKey(options.health);
	return shared(key, async () => {
		const query = options.health ? `?health=${options.health}` : "";
		const res = await request<{ data: SubgraphListItem[] }>(query);
		if (res.kind === "ok") {
			const at = Date.now();
			const fromList = Object.fromEntries(
				res.data.data.flatMap((s) =>
					s.health ? [[s.name, { data: s.health, at }]] : [],
				),
			);
			set({
				list: { data: res.data.data, at },
				health: { ...current().health, ...fromList },
			});
			return { kind: "ok", data: res.data.data } as const;
		}
		if (res.kind === "not_found") {
			set({ list: { data: [], at: Date.now() } });
			return { kind: "ok", data: [] } as const;
		}
		return res;
	});
}

/** One list read that also brings every subgraph's 24-hour health. A tenant
 *  still on an older image ignores `?health=`, so those items fall back to a
 *  health read each; drop the fallback once every tenant has rolled. */
export async function refreshListAndHealth() {
	const res = await refreshList({ health: HEALTH_WEEK_HOURS });
	if (res.kind === "ok") {
		await Promise.all(
			res.data
				.filter((s) => s.health === undefined)
				.map((s) => refreshHealth(s.name, HEALTH_WEEK_HOURS)),
		);
	}
	return res;
}

export function refreshDetail(
	name: string,
): Promise<SubgraphsResult<SubgraphDetailData>> {
	const key = `subgraphs:detail:${name}`;
	return shared(key, async () => {
		const res = await request<SubgraphDetailData>(`/${seg(name)}`);
		if (res.kind === "ok") {
			set({
				detail: {
					...current().detail,
					[name]: { data: res.data, at: Date.now() },
				},
			});
		}
		return res;
	});
}

/** Hourly buckets, oldest first, ending with the current hour. */
export function refreshHealth(
	name: string,
	hours = 24,
): Promise<SubgraphsResult<SubgraphHealthData>> {
	const key = `subgraphs:health:${name}:${hours}`;
	return shared(key, async () => {
		const res = await request<SubgraphHealthData>(
			`/${seg(name)}/health?hours=${hours}`,
		);
		if (res.kind === "ok") {
			set({
				health: {
					...current().health,
					[name]: { data: res.data, at: Date.now() },
				},
			});
		}
		return res;
	});
}

export function refreshErrors(
	name: string,
): Promise<SubgraphsResult<SubgraphErrorGroup[]>> {
	const key = `subgraphs:errors:${name}`;
	return shared(key, async () => {
		const res = await request<{ data: SubgraphErrorGroup[] }>(
			`/${seg(name)}/errors?limit=20`,
		);
		if (res.kind === "ok") {
			set({
				errors: {
					...current().errors,
					[name]: { data: res.data.data, at: Date.now() },
				},
			});
			return { kind: "ok", data: res.data.data } as const;
		}
		return res;
	});
}

export function refreshSource(
	name: string,
): Promise<SubgraphsResult<SubgraphSource>> {
	const key = `subgraphs:source:${name}`;
	return shared(key, async () => {
		const res = await request<SubgraphSource>(`/${seg(name)}/source`);
		if (res.kind === "ok") {
			set({
				source: {
					...current().source,
					[name]: { data: res.data, at: Date.now() },
				},
			});
		}
		return res;
	});
}

/** One page of a table's rows. Not cached: callers hold what they read. */
export function fetchRows(
	name: string,
	table: string,
	query: string,
): Promise<SubgraphsResult<SubgraphRowsPage>> {
	return request<SubgraphRowsPage>(`/${seg(name)}/rows/${seg(table)}?${query}`);
}
