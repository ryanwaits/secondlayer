"use client";

import type { ReplayProgress } from "@secondlayer/shared/schemas/webhooks";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { WEBHOOK_USD_PER_M } from "./prices";
import { getRecentReplays } from "./webhooks-data";
import { poll } from "./webhooks-store";

/** Percent delivered or given up, 0-100, floor. 0 when total is 0. */
export function replayPercent(p: ReplayProgress): number {
	if (p.total <= 0) return 0;
	return Math.min(100, Math.floor((p.processed / p.total) * 100));
}

export type ReplaySample = { at: number; settled: number };

/**
 * Minutes left from samples of `{ at: ms, settled: delivered + gave up }`.
 * Null until the first and last samples are 2 s+ apart and show progress.
 * Never below 1.
 */
export function minutesLeft(
	samples: readonly ReplaySample[],
	total: number,
): number | null {
	const first = samples[0];
	const last = samples[samples.length - 1];
	if (!first || !last) return null;
	const elapsedMs = last.at - first.at;
	const settled = last.settled - first.settled;
	if (elapsedMs < 2000 || settled <= 0) return null;
	const left = Math.max(0, total - last.settled);
	const minutes = Math.ceil(left / (settled / elapsedMs) / 60_000);
	return Math.max(1, minutes);
}

/**
 * "About 3,812 events · $0.04". `knownEvents` is a lower bound, so pass
 * `lowerBound` when the range reaches past what the outbox keeps and the line
 * reads "At least". Cost is events x the webhook rate, two decimals, "under
 * $0.01" below a cent.
 */
export function estimateLine(knownEvents: number, lowerBound: boolean): string {
	const cost = (knownEvents * WEBHOOK_USD_PER_M) / 1e6;
	const price = cost < 0.005 ? "under $0.01" : `$${cost.toFixed(2)}`;
	return `${lowerBound ? "At least" : "About"} ${knownEvents.toLocaleString("en-US")} events · ${price}`;
}

/** The step-3 model for a failing webhook: requeue when something gave up, else a done note. */
export function recoveryStep3(dead: { count: number }):
	| { kind: "requeue"; count: number }
	| { kind: "nothing" } {
	return dead.count > 0
		? { kind: "requeue", count: dead.count }
		: { kind: "nothing" };
}

export function isReplayActive(p: ReplayProgress): boolean {
	return p.status === "scanning" || p.status === "running";
}

/** Poll cadence for the account-wide list: fast while a replay runs. */
export const REPLAYS_ACTIVE_MS = 3000;
export const REPLAYS_IDLE_MS = 30_000;

/**
 * One store for every subscriber: the account's recent replays, polled only
 * while a component is subscribed. Two pages must not start two polls.
 */
let recent: ReplayProgress[] | null = null;
let stop: (() => void) | undefined;
const listeners = new Set<() => void>();

function publish(next: ReplayProgress[]) {
	recent = next;
	for (const l of listeners) l();
}

function start() {
	stop = poll(async () => {
		const res = await getRecentReplays();
		if (res.kind === "ok") publish(res.data.data);
		const active = (recent ?? []).some(isReplayActive);
		return {
			retryAfterMs: active ? REPLAYS_ACTIVE_MS : REPLAYS_IDLE_MS,
		};
	}, REPLAYS_IDLE_MS);
}

/** Insert or update one replay at once, without waiting for the next poll. */
export function noteReplayStarted(p: ReplayProgress) {
	const rest = (recent ?? []).filter((r) => r.replayId !== p.replayId);
	const becameActive =
		isReplayActive(p) && !(recent ?? []).some(isReplayActive);
	publish([p, ...rest]);
	if (becameActive && stop) {
		// The pending timer is the idle one; restart so the 3 s cadence applies.
		stop();
		start();
	}
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	if (listeners.size === 1) start();
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			stop?.();
			stop = undefined;
		}
	};
}

/** The account's recent and running replays; null until the first read. */
export function useRecentReplays(): ReplayProgress[] | null {
	return useSyncExternalStore(
		subscribe,
		() => recent,
		() => null,
	);
}

/** The replay of `webhookId` that is scanning or running, newest first. */
export function runningReplayFor(
	replays: readonly ReplayProgress[] | null,
	webhookId: string,
): ReplayProgress | null {
	return (
		(replays ?? [])
			.filter((p) => p.webhookId === webhookId && isReplayActive(p))
			.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0] ??
		null
	);
}

/**
 * Minutes left for a replay that updates over time. Keeps the last 10 values it
 * has seen; null until they show progress (see `minutesLeft`).
 */
export function useMinutesLeft(progress: ReplayProgress | null): number | null {
	const samples = useRef<ReplaySample[]>([]);
	const replayId = useRef<string | null>(null);
	const [minutes, setMinutes] = useState<number | null>(null);
	useEffect(() => {
		if (!progress) return;
		if (replayId.current !== progress.replayId) {
			replayId.current = progress.replayId;
			samples.current = [];
		}
		if (!isReplayActive(progress)) {
			setMinutes(null);
			return;
		}
		samples.current = [
			...samples.current,
			{ at: Date.now(), settled: progress.processed },
		].slice(-10);
		setMinutes(minutesLeft(samples.current, progress.total));
	}, [progress]);
	return minutes;
}
