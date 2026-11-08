"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { notifyAll } from "./epoch";
import { clearInsights } from "./insights-store";
import { TOPUP_MAX_USD, TOPUP_MIN_USD } from "./prices";
import { clearRequestCache, shared } from "./request-cache";
import type { RowsResponse } from "./rows";
import { clearSubgraphsData } from "./subgraphs-store";
import type { ApiKey, ConnectedApp, CreditAdded } from "./types";
import {
	type Burn,
	type DailySpend,
	type HostedStack,
	type UsageByMonth,
	type UsageResponse,
	withUsageMonth,
} from "./usage";
import { clearWebhooksData } from "./webhooks-store";

/**
 * Account data the nav chip, the floating cards and the /account pages all read. One
 * store, so a top-up that lands on the credits page moves the balance in the
 * nav too, and a key created in the card shows up on the keys page.
 */

/** Credit packs the API sells (`CREDIT_PACKS_USD` in packages/api). */
export const PACKS_USD = [10, 25, 50, 100] as const;
export type PackUsd = (typeof PACKS_USD)[number];

/** A whole-dollar amount the top-up route accepts. */
export function isTopupUsd(n: number): boolean {
	return Number.isInteger(n) && n >= TOPUP_MIN_USD && n <= TOPUP_MAX_USD;
}

export type Billing = {
	creditsUsdMicros: string;
	spentThisMonthUsdMicros: string;
};

export type BalanceAlerts = { notify7d: boolean; notify2d: boolean };

/** Monthly spend cap for hosted Index/Streams reads past the free rows
 *  allowance. `monthlyCapCents: null` means no cap set. */
export type Caps = {
	monthlyCapCents: number | null;
	alertThresholdPct: number;
	frozenAt: string | null;
	alertSentAt: string | null;
};

type State = {
	billing: Billing | null;
	keys: ApiKey[] | null;
	/** Apps signed in to the hosted MCP (OAuth grants). */
	apps: ConnectedApp[] | null;
	usage: UsageByMonth;
	/** Day-by-day spend, keyed by month like `usage` — only the requested
	 *  month's chart data. */
	daily: Record<string, DailySpend[]>;
	/** Trailing-24h burn rate. Always "now", independent of whichever
	 *  month's usage was last fetched — the latest response always wins. */
	burn: Burn | null;
	/** Hosted stack state + last-24h memory. Same "always now" rule as
	 *  `burn`. */
	service: HostedStack | null;
	alerts: BalanceAlerts | null;
	caps: Caps | null;
	/** Latest top-ups and grants, newest first. */
	credits: CreditAdded[] | null;
	/** Rows delivered: allowance, per day, sources, call sizes, errors. */
	rows: RowsResponse | null;
	/** Why a slot above is still `null`: its first read is under way, or failed. */
	status: Partial<Record<Slot, "loading" | "error">>;
};

/** The slots that start `null` and fill from one read. */
export type Slot =
	| "billing"
	| "keys"
	| "apps"
	| "alerts"
	| "caps"
	| "credits"
	| "rows";

/** One slot as a screen reads it: a read that failed is not a read still loading. */
export type Resource<T> =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ok"; data: T }
	| { status: "error" };

/** The slot's data once it has some, else why it has none. */
export function resourceOf<S extends Slot>(
	account: State,
	slot: S,
): Resource<NonNullable<State[S]>> {
	const data = account[slot];
	if (data !== null)
		return { status: "ok", data: data as NonNullable<State[S]> };
	return { status: account.status[slot] ?? "idle" };
}

const EMPTY: State = {
	billing: null,
	keys: null,
	apps: null,
	usage: {},
	daily: {},
	burn: null,
	service: null,
	alerts: null,
	caps: null,
	credits: null,
	rows: null,
	status: {},
};
let state: State = EMPTY;
/** Bumped on sign-out: a read that started before it must not fill the next account's store. */
let epoch = 0;
const listeners = new Set<() => void>();

function current(): State {
	return state;
}

function set(patch: Partial<State>) {
	state = { ...state, ...patch };
	for (const l of listeners) l();
}

function setStatus(slot: Slot, status: "loading" | "error" | undefined) {
	if (state.status[slot] === status) return;
	const next = { ...state.status };
	if (status) next[slot] = status;
	else delete next[slot];
	set({ status: next });
}

/**
 * One read into one slot. A failed first read marks the slot `error` (a
 * failed refresh keeps the data it had), and a read that began before
 * sign-out is dropped instead of refilling the store.
 */
function loadSlot<T>(
	slot: Slot,
	run: () => Promise<T | null>,
	apply: (value: T) => Partial<State>,
): Promise<T | null> {
	return shared(slot, async () => {
		const started = epoch;
		if (current()[slot] === null) setStatus(slot, "loading");
		let value: T | null = null;
		try {
			value = await run();
		} catch {
			value = null;
		}
		if (started !== epoch) return value;
		if (value === null) {
			if (current()[slot] === null) setStatus(slot, "error");
			return null;
		}
		const status = { ...current().status };
		delete status[slot];
		set({ ...apply(value), status });
		return value;
	});
}

/** The JSON of a GET, or null when it was refused. */
async function getJson<T>(url: string): Promise<T | null> {
	const res = await fetch(url);
	return res.ok ? ((await res.json()) as T) : null;
}

function subscribe(l: () => void) {
	listeners.add(l);
	return () => listeners.delete(l);
}

/** A plain (non-hook) read of the current state, for refreshers and tests. */
export function accountSnapshot(): State {
	return current();
}

/** What a server render read for the page, in store shape. */
export type AccountSeed = Partial<State>;

const AccountSeedContext = createContext<AccountSeed | null>(null);

const appliedSeeds = new WeakSet<object>();
const serverStates = new WeakMap<object, State>();

/** Puts a seed into the client store, once per seed. Quiet on purpose: it runs
 *  while a component renders, so it must not wake other subscribers. */
function applySeed(seed: AccountSeed): void {
	if (typeof window === "undefined" || appliedSeeds.has(seed)) return;
	appliedSeeds.add(seed);
	state = {
		...state,
		...seed,
		usage: { ...state.usage, ...seed.usage },
		daily: { ...state.daily, ...seed.daily },
	};
}

/** Hands a page's server-read account data to every `useAccountData()` below
 *  it, and starts the client store from it. The nav sits outside this tree and
 *  reads the store, so it gets the same data once the client has it. The
 *  server never writes the module store: it is shared across requests. */
export function AccountSeedProvider({
	seed,
	children,
}: {
	seed: AccountSeed;
	children?: React.ReactNode;
}) {
	applySeed(seed);
	return (
		<AccountSeedContext.Provider value={seed}>
			{children}
		</AccountSeedContext.Provider>
	);
}

/** The account data. Under a seed, the server render and the hydration pass
 *  read it, so the HTML carries the data. */
export function useAccountData(): State {
	const seed = useContext(AccountSeedContext);
	let server = EMPTY;
	if (seed) {
		server = serverStates.get(seed) ?? { ...EMPTY, ...seed };
		serverStates.set(seed, server);
	}
	return useSyncExternalStore(subscribe, accountSnapshot, () => server);
}

export function refreshBilling(): Promise<Billing | null> {
	return loadSlot(
		"billing",
		() => getJson<Billing>("/api/billing/status"),
		(billing) => ({ billing }),
	);
}

/** For a screen mounting: load billing unless the page already carried it. */
export function ensureBilling(): Promise<unknown> {
	return current().billing ? Promise.resolve() : refreshBilling();
}

/** This account's usage_ledger for one UTC calendar month (`YYYY-MM`),
 *  grouped by unit, plus that month's daily chart data and the always-now
 *  burn rate + hosted stack snapshot. Writes only that month's `usage`/
 *  `daily` entry, so a slow response for a month the caller has moved on
 *  from can't overwrite whatever month is on screen now — `burn` and
 *  `service` always take the latest response, since they're never
 *  month-scoped. Mirrors `refreshBilling`. */
export function refreshUsage(month: string): Promise<UsageResponse | null> {
	return shared(`usage:${month}`, async () => {
		const started = epoch;
		try {
			const res = await fetch(`/api/billing/usage?month=${month}`);
			if (!res.ok) return null;
			const data = (await res.json()) as UsageResponse;
			if (started !== epoch) return data;
			set({
				usage: withUsageMonth(current().usage, month, data.usage),
				daily: { ...current().daily, [month]: data.daily },
				burn: data.burn,
				service: data.service,
			});
			return data;
		} catch {
			return null;
		}
	});
}

/** For a screen mounting: load a month's usage unless it is already here. */
export function ensureUsage(month: string): Promise<unknown> {
	return current().usage[month] ? Promise.resolve() : refreshUsage(month);
}

/** The signed-in account's balance-alert email preferences. */
export function refreshAlerts(): Promise<BalanceAlerts | null> {
	return loadSlot(
		"alerts",
		() => getJson<BalanceAlerts>("/api/billing/alerts"),
		(alerts) => ({ alerts }),
	);
}

/** For a screen mounting: load the alert switches unless they are already here. */
export function ensureAlerts(): Promise<unknown> {
	return current().alerts ? Promise.resolve() : refreshAlerts();
}

let alertsWrites = 0;
let capWrites = 0;

/** Optimistic PUT: the caller flips the switch immediately, this persists
 *  it and reconciles with what the server actually stored (or rolls back
 *  on failure — the caller shows a toast). */
export async function updateAlerts(
	patch: Partial<BalanceAlerts>,
): Promise<BalanceAlerts | null> {
	const started = epoch;
	const mine = ++alertsWrites;
	const res = await fetch("/api/billing/alerts", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(patch),
	});
	if (!res.ok) return null;
	const alerts = (await res.json()) as BalanceAlerts;
	// Responses can arrive out of order: only the newest write sets the store.
	if (started === epoch && mine === alertsWrites) set({ alerts });
	return alerts;
}

/** The signed-in account's monthly spend-cap setting. */
export function refreshCaps(): Promise<Caps | null> {
	return loadSlot(
		"caps",
		() => getJson<Caps>("/api/billing/caps"),
		(caps) => ({ caps }),
	);
}

/** For a screen mounting: load the cap unless it is already here. */
export function ensureCaps(): Promise<unknown> {
	return current().caps ? Promise.resolve() : refreshCaps();
}

/** The signed-in account's latest top-ups and grants. */
export function refreshCredits(): Promise<CreditAdded[] | null> {
	return loadSlot(
		"credits",
		async () =>
			(await getJson<{ credits: CreditAdded[] }>("/api/billing/credits"))
				?.credits ?? null,
		(credits) => ({ credits }),
	);
}

/** For a screen mounting: load the credits list unless it is already here. */
export function ensureCredits(): Promise<unknown> {
	return current().credits ? Promise.resolve() : refreshCredits();
}

/** Rows delivered for the signed-in account. Keeps the last good data on a
 *  failed refresh and returns null, so the caller can tell a first-load
 *  failure from a stale refresh. */
export function refreshRows(): Promise<RowsResponse | null> {
	return loadSlot(
		"rows",
		() => getJson<RowsResponse>("/api/billing/rows"),
		(rows) => ({ rows }),
	);
}

/** Set or clear the monthly spend cap. `monthlyCapCents: null` clears it. */
export async function updateCap(
	monthlyCapCents: number | null,
): Promise<Caps | null> {
	const started = epoch;
	const mine = ++capWrites;
	const res = await fetch("/api/billing/caps", {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ monthlyCapCents }),
	});
	if (!res.ok) return null;
	const caps = (await res.json()) as Caps;
	// Responses can arrive out of order: only the newest write sets the store.
	if (started === epoch && mine === capWrites) set({ caps });
	return caps;
}

export async function refreshKeys(): Promise<void> {
	await loadSlot(
		"keys",
		async () => (await getJson<{ keys: ApiKey[] }>("/api/keys"))?.keys ?? null,
		(keys) => ({ keys }),
	);
}

/** For a screen mounting: load keys unless they are already here. */
export function ensureKeys(): Promise<void> {
	return current().keys ? Promise.resolve() : refreshKeys();
}

export async function refreshApps(): Promise<void> {
	await loadSlot(
		"apps",
		async () =>
			(await getJson<{ grants: ConnectedApp[] }>("/api/oauth/grants"))
				?.grants ?? null,
		(apps) => ({ apps }),
	);
}

/** For a screen mounting: load connected apps unless they are already here. */
export function ensureApps(): Promise<void> {
	return current().apps ? Promise.resolve() : refreshApps();
}

/** Revoke an app: its tokens stop working at once. */
export async function revokeApp(id: string): Promise<void> {
	const res = await fetch(`/api/oauth/grants/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
	if (!res.ok) {
		const data = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(data.error ?? "Couldn't revoke that app");
	}
	await refreshApps();
}

/** Forget everything on sign-out so the next account never sees it.
 *  `deferred` wakes subscribers a microtask later, for a clear that runs while
 *  a component renders. */
export function clearAccountData(options: { deferred?: boolean } = {}): void {
	epoch++;
	state = EMPTY;
	notifyAll(listeners, options.deferred);
	clearWebhooksData(options);
	clearSubgraphsData(options);
	clearInsights(options);
	clearRequestCache();
}

/** A refused key creation: the status tells the cap (403) from the rate limit (429). */
export class CreateKeyError extends Error {
	constructor(
		message: string,
		public status: number,
		/** Seconds until another key can be made, on a 429. */
		public retryAfter?: number,
	) {
		super(message);
		this.name = "CreateKeyError";
	}
}

/** Mint a key. Returns its full value, which is never retrievable again. */
export async function createKey(name: string): Promise<string> {
	const res = await fetch("/api/keys", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name }),
	});
	const data = (await res.json().catch(() => ({}))) as {
		key?: string;
		error?: string;
		retryAfter?: number;
	};
	if (!res.ok || !data.key)
		throw new CreateKeyError(
			data.error ?? "Couldn't create a key",
			res.status,
			data.retryAfter,
		);
	await refreshKeys();
	return data.key;
}

export async function revokeKey(id: string): Promise<void> {
	const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
	if (!res.ok) {
		const data = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(data.error ?? "Couldn't revoke that key");
	}
	await refreshKeys();
}

/** Replace a key's secret. Returns the new value, which is never retrievable again. */
export async function rotateKey(
	id: string,
): Promise<{ key: string; name: string }> {
	const res = await fetch(`/api/keys/${id}/rotate`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: "{}",
	});
	const data = (await res.json().catch(() => ({}))) as {
		key?: string;
		name?: string | null;
		error?: string;
		retryAfter?: number;
	};
	if (!res.ok || !data.key)
		throw new CreateKeyError(
			data.error ?? "Couldn't rotate that key",
			res.status,
			data.retryAfter,
		);
	await refreshKeys();
	return { key: data.key, name: data.name ?? "" };
}

const TOPUP_STORAGE = "sl_topup";

/**
 * What the credits list showed when checkout began: the newest top-up's time
 * (null when there was none). A top-up that lands afterwards is a newer row.
 * The whole value is null when the list could not be read, and then nothing
 * can be confirmed.
 */
export type CreditsBaseline = { latestTopupAt: string | null } | null;

type PendingTopup = { amount: number; creditsBaseline: CreditsBaseline };

/** The baseline a credits list gives. Null when the list isn't known. */
export function creditsBaseline(
	credits: readonly CreditAdded[] | null,
): CreditsBaseline {
	if (credits === null) return null;
	const topups = credits.filter((c) => c.kind === "topup");
	return {
		latestTopupAt: topups.reduce<string | null>(
			(latest, c) =>
				latest === null || Date.parse(c.occurredAt) > Date.parse(latest)
					? c.occurredAt
					: latest,
			null,
		),
	};
}

/**
 * Send the reader to Stripe Checkout. The credits list before paying is kept
 * for the return trip, so the credits page can tell "still confirming" from
 * "landed" from the server's own record of top-ups.
 */
export async function startCheckout(amount: number): Promise<void> {
	const res = await fetch("/api/billing/topup", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ amount }),
	});
	const data = (await res.json().catch(() => ({}))) as {
		url?: string;
		error?: string;
	};
	if (!res.ok || !data.url)
		throw new Error(data.error ?? "Couldn't start checkout");
	const pending: PendingTopup = {
		amount,
		creditsBaseline: creditsBaseline(
			current().credits ?? (await refreshCredits()),
		),
	};
	try {
		sessionStorage.setItem(TOPUP_STORAGE, JSON.stringify(pending));
	} catch {
		// Storage blocked: the return still shows, just without the amount.
	}
	window.location.href = data.url;
}

export type TopupReturn =
	| {
			result: "success";
			amount: number | null;
			creditsBaseline: CreditsBaseline;
	  }
	| { result: "cancelled" };

/** Read (once) whether this page load is the way back from Stripe. */
export function takeTopupReturn(): TopupReturn | null {
	const params = new URLSearchParams(location.search);
	const result = params.get("topup");
	if (!result) return null;
	history.replaceState(null, "", location.pathname);
	let pending: Partial<PendingTopup> | null = null;
	try {
		const raw = sessionStorage.getItem(TOPUP_STORAGE);
		sessionStorage.removeItem(TOPUP_STORAGE);
		pending = raw ? (JSON.parse(raw) as Partial<PendingTopup>) : null;
	} catch {}
	if (result === "cancelled") return { result: "cancelled" };
	return {
		result: "success",
		amount: pending?.amount ?? null,
		creditsBaseline: pending?.creditsBaseline ?? null,
	};
}

export type TopupStatus = "landed" | "waiting" | "unknown";

/**
 * Has the top-up shown up in the credits list? A top-up is a row newer than
 * the baseline (and, when the amount is known, for that amount). Without a
 * baseline nothing can be told apart from an older top-up, so the answer is
 * `unknown`, never `landed`. The balance isn't consulted: spending moves it
 * both ways while the payment is confirmed.
 */
export function topupStatus(
	credits: readonly CreditAdded[] | null,
	amount: number | null,
	baseline: CreditsBaseline,
): TopupStatus {
	if (baseline === null) return "unknown";
	if (credits === null) return "waiting";
	const since = baseline.latestTopupAt;
	const found = credits.some(
		(c) =>
			c.kind === "topup" &&
			(since === null || Date.parse(c.occurredAt) > Date.parse(since)) &&
			(amount === null || Number(c.usdMicros) === amount * 1_000_000),
	);
	return found ? "landed" : "waiting";
}

export function formatUsd(micros: string | number | bigint): string {
	return `$${(Number(micros) / 1_000_000).toFixed(2)}`;
}

export function formatDate(iso: string | null): string {
	if (!iso) return "never";
	return new Date(iso).toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}
