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

export const PACKS_USD = [10, 25, 50, 100] as const;
export type PackUsd = (typeof PACKS_USD)[number];

export function isTopupUsd(n: number): boolean {
	return Number.isInteger(n) && n >= TOPUP_MIN_USD && n <= TOPUP_MAX_USD;
}

export type Billing = {
	creditsUsdMicros: string;
	spentThisMonthUsdMicros: string;
};

export type BalanceAlerts = { notify7d: boolean; notify2d: boolean };

export type Caps = {
	monthlyCapCents: number | null;
	alertThresholdPct: number;
	frozenAt: string | null;
	alertSentAt: string | null;
};

type State = {
	billing: Billing | null;
	keys: ApiKey[] | null;
	apps: ConnectedApp[] | null;
	usage: UsageByMonth;
	daily: Record<string, DailySpend[]>;
	burn: Burn | null;
	service: HostedStack | null;
	alerts: BalanceAlerts | null;
	caps: Caps | null;
	credits: CreditAdded[] | null;
	rows: RowsResponse | null;
	status: Partial<Record<Slot, "loading" | "error">>;
};

export type Slot =
	| "billing"
	| "keys"
	| "apps"
	| "alerts"
	| "caps"
	| "credits"
	| "rows";

export type Resource<T> =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ok"; data: T }
	| { status: "error" };

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

async function getJson<T>(url: string): Promise<T | null> {
	const res = await fetch(url);
	return res.ok ? ((await res.json()) as T) : null;
}

function subscribe(l: () => void) {
	listeners.add(l);
	return () => listeners.delete(l);
}

export function accountSnapshot(): State {
	return current();
}

export type AccountSeed = Partial<State>;

const AccountSeedContext = createContext<AccountSeed | null>(null);

const appliedSeeds = new WeakSet<object>();
const serverStates = new WeakMap<object, State>();

/** Quiet on purpose: it runs while a component renders, so it must not wake
 *  other subscribers. */
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

/** The server never writes the module store: it is shared across requests. */
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

export function ensureBilling(): Promise<unknown> {
	return current().billing ? Promise.resolve() : refreshBilling();
}

/** Writes only that month's `usage`/`daily` entry, so a slow response for a
 *  month the caller has moved on from can't overwrite whatever month is on
 *  screen now — `burn` and `service` always take the latest response, since
 *  they're never month-scoped. */
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

export function ensureUsage(month: string): Promise<unknown> {
	return current().usage[month] ? Promise.resolve() : refreshUsage(month);
}

export function refreshAlerts(): Promise<BalanceAlerts | null> {
	return loadSlot(
		"alerts",
		() => getJson<BalanceAlerts>("/api/billing/alerts"),
		(alerts) => ({ alerts }),
	);
}

export function ensureAlerts(): Promise<unknown> {
	return current().alerts ? Promise.resolve() : refreshAlerts();
}

let alertsWrites = 0;
let capWrites = 0;

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

export function refreshCaps(): Promise<Caps | null> {
	return loadSlot(
		"caps",
		() => getJson<Caps>("/api/billing/caps"),
		(caps) => ({ caps }),
	);
}

export function ensureCaps(): Promise<unknown> {
	return current().caps ? Promise.resolve() : refreshCaps();
}

export function refreshCredits(): Promise<CreditAdded[] | null> {
	return loadSlot(
		"credits",
		async () =>
			(await getJson<{ credits: CreditAdded[] }>("/api/billing/credits"))
				?.credits ?? null,
		(credits) => ({ credits }),
	);
}

export function ensureCredits(): Promise<unknown> {
	return current().credits ? Promise.resolve() : refreshCredits();
}

export function refreshRows(): Promise<RowsResponse | null> {
	return loadSlot(
		"rows",
		() => getJson<RowsResponse>("/api/billing/rows"),
		(rows) => ({ rows }),
	);
}

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

export function ensureApps(): Promise<void> {
	return current().apps ? Promise.resolve() : refreshApps();
}

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

export function clearAccountData(options: { deferred?: boolean } = {}): void {
	epoch++;
	state = EMPTY;
	notifyAll(listeners, options.deferred);
	clearWebhooksData(options);
	clearSubgraphsData(options);
	clearInsights(options);
	clearRequestCache();
}

export class CreateKeyError extends Error {
	constructor(
		message: string,
		public status: number,
		public retryAfter?: number,
	) {
		super(message);
		this.name = "CreateKeyError";
	}
}

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

export type CreditsBaseline = { latestTopupAt: string | null } | null;

type PendingTopup = { amount: number; creditsBaseline: CreditsBaseline };

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
	} catch {}
	window.location.href = data.url;
}

export type TopupReturn =
	| {
			result: "success";
			amount: number | null;
			creditsBaseline: CreditsBaseline;
	  }
	| { result: "cancelled" };

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
 * Without a baseline nothing can be told apart from an older top-up, so the
 * answer is `unknown`, never `landed`. The balance isn't consulted: spending
 * moves it both ways while the payment is confirmed.
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
	// UTC and en-US, so the same instant reads as the same date for everyone.
	return new Date(iso).toLocaleDateString("en-US", {
		timeZone: "UTC",
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

export function formatDateTime(iso: string): string {
	const time = new Date(iso).toLocaleTimeString("en-US", {
		timeZone: "UTC",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});
	return `${formatDate(iso)}, ${time} UTC`;
}

const AGE_UNITS: [string, number][] = [
	["year", 365 * 86_400_000],
	["month", 30 * 86_400_000],
	["day", 86_400_000],
	["hour", 3_600_000],
	["minute", 60_000],
];

export function formatAge(iso: string, now: number = Date.now()): string {
	const ms = now - new Date(iso).getTime();
	for (const [unit, size] of AGE_UNITS) {
		const n = Math.floor(ms / size);
		if (n >= 1) return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
	}
	return "just now";
}
