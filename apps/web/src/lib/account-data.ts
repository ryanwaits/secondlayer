"use client";

import { useSyncExternalStore } from "react";
import type { ApiKey } from "./types";

/**
 * Account data the nav chip, the floating cards and the /account pages all read. One
 * store, so a top-up that lands on the credits page moves the balance in the
 * nav too, and a key created in the card shows up on the keys page.
 */

/** Credit packs the API sells (`CREDIT_PACKS_USD` in packages/api). */
export const PACKS_USD = [10, 25, 50, 100] as const;
export type PackUsd = (typeof PACKS_USD)[number];

export type Billing = {
	creditsUsdMicros: string;
	spentThisMonthUsdMicros: string;
};

type State = { billing: Billing | null; keys: ApiKey[] | null };

const EMPTY: State = { billing: null, keys: null };
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

export function useAccountData(): State {
	return useSyncExternalStore(
		subscribe,
		() => state,
		() => EMPTY,
	);
}

export async function refreshBilling(): Promise<Billing | null> {
	try {
		const res = await fetch("/api/billing/status");
		if (!res.ok) return null;
		const billing = (await res.json()) as Billing;
		set({ billing });
		return billing;
	} catch {
		return null;
	}
}

export async function refreshKeys(): Promise<void> {
	try {
		const res = await fetch("/api/keys");
		if (!res.ok) return;
		const data = (await res.json()) as { keys: ApiKey[] };
		set({ keys: data.keys });
	} catch {
		// Keep what we had; the list retries on the next open.
	}
}

/** Forget everything on sign-out so the next account never sees it. */
export function clearAccountData(): void {
	set(EMPTY);
}

export function activeKeys(keys: ApiKey[] | null): ApiKey[] {
	return (keys ?? []).filter((k) => k.status === "active");
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
	};
	if (!res.ok || !data.key)
		throw new Error(data.error ?? "Couldn't create a key");
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

const TOPUP_STORAGE = "sl_topup";

type PendingTopup = { amount: number; beforeMicros: string | null };

/**
 * Send the reader to Stripe Checkout. The balance before paying is kept for
 * the return trip, so the credits page can tell "still confirming" from
 * "landed" without the API reporting individual top-ups.
 */
export async function startCheckout(amount: PackUsd): Promise<void> {
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
		beforeMicros: state.billing?.creditsUsdMicros ?? null,
	};
	try {
		sessionStorage.setItem(TOPUP_STORAGE, JSON.stringify(pending));
	} catch {
		// Storage blocked: the return still shows, just without the amount.
	}
	window.location.href = data.url;
}

export type TopupReturn =
	| { result: "success"; amount: number | null; beforeMicros: string | null }
	| { result: "cancelled" };

/** Read (once) whether this page load is the way back from Stripe. */
export function takeTopupReturn(): TopupReturn | null {
	const params = new URLSearchParams(location.search);
	const result = params.get("topup");
	if (!result) return null;
	history.replaceState(null, "", location.pathname);
	let pending: PendingTopup | null = null;
	try {
		const raw = sessionStorage.getItem(TOPUP_STORAGE);
		sessionStorage.removeItem(TOPUP_STORAGE);
		pending = raw ? (JSON.parse(raw) as PendingTopup) : null;
	} catch {}
	if (result === "cancelled") return { result: "cancelled" };
	return {
		result: "success",
		amount: pending?.amount ?? null,
		beforeMicros: pending?.beforeMicros ?? null,
	};
}

/** Has a top-up of `amount` landed on a balance that stood at `before`? */
export function topupLanded(
	billing: Billing | null,
	amount: number | null,
	beforeMicros: string | null,
): boolean {
	if (!billing) return false;
	if (amount === null || beforeMicros === null) return true;
	// Micros of a prepaid balance stay far below 2^53, so plain numbers are exact.
	return (
		Number(billing.creditsUsdMicros) >=
		Number(beforeMicros) + amount * 1_000_000
	);
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
