"use client";

import { PUBLIC_API_URL } from "@/lib/public-api";
import { useSyncExternalStore } from "react";

const STATUS_URL = `${PUBLIC_API_URL}/public/status`;
const POLL_MS = 5_000;
const MAX_INTERVALS = 10;

export type ChainTip = {
	height: number | null;
	/** ms epoch when the current height was first seen (seeded from lag_seconds on the first read). */
	seenAt: number | null;
	/** Seconds between the last ≤10 observed height changes, oldest first. */
	intervals: number[];
	/** Mean of `intervals`; null until 2 height changes were observed. */
	avgBlockSec: number | null;
	/** Increments on every observed height change (drives the pulse). */
	beat: number;
};

export const EMPTY_TIP: ChainTip = {
	height: null,
	seenAt: null,
	intervals: [],
	avgBlockSec: null,
	beat: 0,
};

/** Fold one observed tip into the state. Returns `prev` itself when nothing changed. */
export function nextTip(
	prev: ChainTip,
	height: number,
	lagSeconds: number | null,
	now: number,
): ChainTip {
	if (prev.height === null) {
		return {
			...prev,
			height,
			seenAt: now - (lagSeconds ?? 0) * 1000,
			intervals: [],
			avgBlockSec: null,
		};
	}
	if (height === prev.height) return prev;
	const seen = prev.seenAt ?? now;
	const intervals = [...prev.intervals, (now - seen) / 1000].slice(
		-MAX_INTERVALS,
	);
	return {
		height,
		seenAt: now,
		intervals,
		avgBlockSec:
			intervals.length >= 2
				? intervals.reduce((a, b) => a + b, 0) / intervals.length
				: null,
		beat: prev.beat + 1,
	};
}

export type Staleness = {
	ageSec: number;
	level: "fresh" | "stale" | "down";
};

export function staleness(tip: ChainTip, now: number): Staleness {
	const ageSec =
		tip.seenAt === null ? 0 : Math.floor((now - tip.seenAt) / 1000);
	return {
		ageSec,
		level: ageSec > 600 ? "down" : ageSec > 60 ? "stale" : "fresh",
	};
}

/** Pull height and lag out of a /public/status body; null when height is unusable. */
export function readTip(
	body: unknown,
): { height: number; lagSeconds: number | null } | null {
	const tip = (body as { streams?: { tip?: Record<string, unknown> } } | null)
		?.streams?.tip;
	const height = tip?.block_height;
	if (typeof height !== "number" || !Number.isFinite(height)) return null;
	const lag = tip?.lag_seconds;
	return {
		height,
		lagSeconds: typeof lag === "number" && Number.isFinite(lag) ? lag : null,
	};
}

/**
 * One poller per tab. It reads only while the tab is visible and someone is
 * subscribed, and keeps the last good value through failures.
 */
let state: ChainTip = EMPTY_TIP;
let timer: ReturnType<typeof setTimeout> | undefined;
let inflight = false;
const listeners = new Set<() => void>();

async function poll() {
	timer = undefined;
	if (listeners.size === 0) return;
	if (document.visibilityState === "visible" && !inflight) {
		inflight = true;
		try {
			const res = await fetch(STATUS_URL, { cache: "no-store" });
			const read = res.ok ? readTip(await res.json()) : null;
			if (read) {
				const next = nextTip(state, read.height, read.lagSeconds, Date.now());
				if (next !== state) {
					state = next;
					for (const l of listeners) l();
				}
			}
		} catch {
			// Keep the last value; the next tick retries.
		} finally {
			inflight = false;
		}
	}
	if (listeners.size > 0) timer = setTimeout(poll, POLL_MS);
}

function onVisible() {
	if (document.visibilityState === "visible" && timer === undefined) poll();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	if (listeners.size === 1) {
		document.addEventListener("visibilitychange", onVisible);
		poll();
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			document.removeEventListener("visibilitychange", onVisible);
			clearTimeout(timer);
			timer = undefined;
		}
	};
}

export function useChainTip(): ChainTip {
	return useSyncExternalStore(
		subscribe,
		() => state,
		() => EMPTY_TIP,
	);
}
