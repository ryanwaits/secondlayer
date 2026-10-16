"use client";

import { PUBLIC_API_URL } from "@/lib/public-api";
import { useSyncExternalStore } from "react";

const STATUS_URL = `${PUBLIC_API_URL}/public/status`;
export const POLL_MS = 5_000;
const MAX_INTERVALS = 10;

/** No Stacks block for this long is down: the same bar the API uses for its node. */
export const DOWN_AFTER_SEC = 180;
/** The node this many blocks ahead of our index is us falling behind, not pipeline delay. */
export const BEHIND_BLOCKS = 10;
/** Failed reads in a row before the browser calls us unreachable. */
export const UNREACHABLE_AFTER = 2;

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
	/** Newest Bitcoin block: the node's own view, else the one our tip is anchored to. */
	bitcoin: number | null;
	/** ms epoch the current Bitcoin height was first seen; null until it changes once. */
	bitcoinSeenAt: number | null;
	bitcoinBeat: number;
	/** The Bitcoin block our latest Stacks block is anchored to. */
	anchor: number | null;
	/** The node's Stacks tip; null when the status didn't carry it. */
	nodeTip: number | null;
	/** Failed reads in a row. */
	failures: number;
	/** ms epoch of the last good read. */
	okAt: number | null;
};

export const EMPTY_TIP: ChainTip = {
	height: null,
	seenAt: null,
	intervals: [],
	avgBlockSec: null,
	beat: 0,
	bitcoin: null,
	bitcoinSeenAt: null,
	bitcoinBeat: 0,
	anchor: null,
	nodeTip: null,
	failures: 0,
	okAt: null,
};

/** Fold one observed Stacks height into the state. Returns `prev` itself when nothing changed. */
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
		...prev,
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

export type StatusRead = {
	height: number;
	lagSeconds: number | null;
	anchor: number | null;
	nodeTip: number | null;
	bitcoin: number | null;
};

const num = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

/** Pull the heights out of a /public/status body; null when the Stacks height is unusable. */
export function readTip(body: unknown): StatusRead | null {
	const status = body as {
		streams?: { tip?: Record<string, unknown> };
		node?: Record<string, unknown>;
	} | null;
	const tip = status?.streams?.tip;
	const height = num(tip?.block_height);
	if (height === null) return null;
	const anchor = num(tip?.burn_block_height);
	return {
		height,
		lagSeconds: num(tip?.lag_seconds),
		anchor,
		nodeTip: num(status?.node?.stacksTip),
		bitcoin: num(status?.node?.bitcoinTip) ?? anchor,
	};
}

/** Fold a good read: the Stacks height, the Bitcoin height, and the node's view. */
export function foldRead(
	prev: ChainTip,
	read: StatusRead,
	now: number,
): ChainTip {
	const next = nextTip(prev, read.height, read.lagSeconds, now);
	const bitcoinMoved =
		read.bitcoin !== null &&
		prev.bitcoin !== null &&
		read.bitcoin !== prev.bitcoin;
	return {
		...next,
		bitcoin: read.bitcoin ?? next.bitcoin,
		bitcoinSeenAt: bitcoinMoved ? now : next.bitcoinSeenAt,
		bitcoinBeat: bitcoinMoved ? next.bitcoinBeat + 1 : next.bitcoinBeat,
		anchor: read.anchor,
		nodeTip: read.nodeTip,
		failures: 0,
		okAt: now,
	};
}

/** What the status pill says. Checked in order: unreachable, behind, stalled, live. */
export type ChainState =
	| { kind: "live" }
	/** No Stacks block for `DOWN_AFTER_SEC` while our node is level with our index. */
	| { kind: "stalled"; minutes: number; bitcoinSince: number | null }
	/** The node is `blocks` ahead of our index. */
	| { kind: "behind"; blocks: number }
	/** The browser hasn't heard from us; the heights are from `okAt`. */
	| { kind: "unreachable" };

export function chainState(tip: ChainTip, now: number): ChainState {
	if (tip.failures >= UNREACHABLE_AFTER) return { kind: "unreachable" };
	if (
		tip.height !== null &&
		tip.nodeTip !== null &&
		tip.nodeTip - tip.height >= BEHIND_BLOCKS
	)
		return { kind: "behind", blocks: tip.nodeTip - tip.height };
	const ageSec = tip.seenAt === null ? 0 : (now - tip.seenAt) / 1000;
	if (ageSec >= DOWN_AFTER_SEC)
		return {
			kind: "stalled",
			minutes: Math.floor(ageSec / 60),
			bitcoinSince:
				tip.bitcoin !== null && tip.anchor !== null
					? Math.max(0, tip.bitcoin - tip.anchor)
					: null,
		};
	return { kind: "live" };
}

/**
 * One poller per tab. It reads only while the tab is visible and someone is
 * subscribed, keeps the last good heights through failures, and counts the
 * failures so the pill can say it can't reach us.
 */
let state: ChainTip = EMPTY_TIP;
let timer: ReturnType<typeof setTimeout> | undefined;
let inflight = false;
const listeners = new Set<() => void>();

function publish(next: ChainTip) {
	if (next === state) return;
	state = next;
	for (const l of listeners) l();
}

async function poll() {
	timer = undefined;
	if (listeners.size === 0) return;
	if (document.visibilityState === "visible" && !inflight) {
		inflight = true;
		try {
			const res = await fetch(STATUS_URL, { cache: "no-store" });
			const read = res.ok ? readTip(await res.json()) : null;
			publish(
				read
					? foldRead(state, read, Date.now())
					: { ...state, failures: state.failures + 1 },
			);
		} catch {
			publish({ ...state, failures: state.failures + 1 });
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
