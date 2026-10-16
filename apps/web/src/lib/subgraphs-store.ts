"use client";

import { useSyncExternalStore } from "react";
import { markFresh, shared } from "./request-cache";
import { loadSnapshot, removeSnapshot, saveSnapshot } from "./session-cache";
import { type WebhooksResult, resultForStatus } from "./webhooks-data";

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
	/** Each grid's newest page, keyed `${name}/${table}`. Seeds a revisit's first frame. */
	firstPage: Record<string, CacheEntry<SubgraphRowsPage>>;
};

const EMPTY: State = {
	list: undefined,
	detail: {},
	health: {},
	errors: {},
	firstPage: {},
};

/** How many grids' first pages stay remembered. */
const FIRST_PAGE_LIMIT = 20;

const NAME = "subgraphs";
type Persisted = Pick<State, "list" | "health">;
let state: State = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

/** The first client read pulls this tab's last copy, if any. */
function current(): State {
	if (!hydrated && typeof window !== "undefined") {
		hydrated = true;
		const saved = loadSnapshot<Persisted>(NAME);
		if (saved) state = { ...EMPTY, ...saved };
	}
	return state;
}

function set(patch: Partial<State>) {
	const prev = current();
	state = { ...prev, ...patch };
	if (prev.list !== state.list || prev.health !== state.health)
		saveSnapshot(NAME, { list: state.list, health: state.health });
	for (const l of listeners) l();
}

function subscribe(l: () => void) {
	listeners.add(l);
	return () => listeners.delete(l);
}

export function subgraphsSnapshot(): State {
	return current();
}

export function useSubgraphsCache(): State {
	return useSyncExternalStore(subscribe, subgraphsSnapshot, () => EMPTY);
}

/** Forget every cached subgraph on sign-out. */
export function clearSubgraphsData(): void {
	state = EMPTY;
	hydrated = false;
	removeSnapshot(NAME);
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
	const message =
		body &&
		typeof body === "object" &&
		"error" in body &&
		typeof (body as { error: unknown }).error === "string"
			? (body as { error: string }).error
			: `Request failed (${res.status})`;
	const mapped = resultForStatus(
		res.status,
		res.headers.get("Retry-After"),
		message,
	);
	return mapped ?? { kind: "ok", data: body as T };
}

const seg = encodeURIComponent;

/** A 404 on the list means the account has no subgraphs (and maybe no stack
 *  yet), so it reads as an empty list, never as `not_found`. */
export function refreshList(): Promise<
	Exclude<SubgraphsResult<SubgraphListItem[]>, { kind: "not_found" }>
> {
	return shared("subgraphs:list", async () => {
		const res = await request<{ data: SubgraphListItem[] }>("");
		if (res.kind === "ok") {
			set({ list: { data: res.data.data, at: Date.now() } });
			markFresh("subgraphs:list");
			return { kind: "ok", data: res.data.data } as const;
		}
		if (res.kind === "not_found") {
			set({ list: { data: [], at: Date.now() } });
			markFresh("subgraphs:list");
			return { kind: "ok", data: [] } as const;
		}
		return res;
	});
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
			markFresh(key);
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
			markFresh(key);
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
			markFresh(key);
			return { kind: "ok", data: res.data.data } as const;
		}
		return res;
	});
}

/** One page of a table's rows. Not cached: the grid owns its page state. */
export function fetchRows(
	name: string,
	table: string,
	query: string,
): Promise<SubgraphsResult<SubgraphRowsPage>> {
	return request<SubgraphRowsPage>(`/${seg(name)}/rows/${seg(table)}?${query}`);
}

export const firstPageKey = (name: string, table: string): string =>
	`${name}/${table}`;

/** Remember a grid's first page; the oldest beyond the limit are dropped. */
export function rememberFirstPage(
	name: string,
	table: string,
	page: SubgraphRowsPage,
): void {
	const next = {
		...current().firstPage,
		[firstPageKey(name, table)]: { data: page, at: Date.now() },
	};
	const keys = Object.keys(next);
	if (keys.length > FIRST_PAGE_LIMIT) {
		keys.sort((a, b) => (next[a]?.at ?? 0) - (next[b]?.at ?? 0));
		for (const key of keys.slice(0, keys.length - FIRST_PAGE_LIMIT))
			delete next[key];
	}
	set({ firstPage: next });
}

/** Read a grid's first page ahead of the grid mounting. */
export async function prefetchFirstPage(
	name: string,
	table: string,
	query: string,
): Promise<void> {
	const res = await fetchRows(name, table, query);
	if (res.kind === "ok") rememberFirstPage(name, table, res.data);
}

/** The SSE path for a table's new rows, same filters as the page. */
export function streamUrl(name: string, table: string, query: string): string {
	return `/api/subgraphs/${seg(name)}/rows/${seg(table)}/stream${query ? `?${query}` : ""}`;
}
