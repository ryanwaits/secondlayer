"use client";

import type { ReplayProgress } from "@secondlayer/shared/schemas/webhooks";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { WEBHOOK_USD_PER_M } from "./prices";
import { getRecentReplays } from "./webhooks-data";
import { poll } from "./webhooks-store";

export function replayPercent(p: ReplayProgress): number {
	if (p.total <= 0) return 0;
	return Math.min(100, Math.floor((p.processed / p.total) * 100));
}

export type ReplaySample = { at: number; settled: number };

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

export function estimateLine(knownEvents: number, lowerBound: boolean): string {
	const cost = (knownEvents * WEBHOOK_USD_PER_M) / 1e6;
	const price = cost < 0.005 ? "under $0.01" : `$${cost.toFixed(2)}`;
	return `${lowerBound ? "At least" : "About"} ${knownEvents.toLocaleString("en-US")} events · ${price}`;
}

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

export function noteReplayStarted(p: ReplayProgress) {
	const rest = (recent ?? []).filter((r) => r.replayId !== p.replayId);
	const becameActive =
		isReplayActive(p) && !(recent ?? []).some(isReplayActive);
	publish([p, ...rest]);
	if (becameActive && stop) {
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

export function useRecentReplays(): ReplayProgress[] | null {
	return useSyncExternalStore(
		subscribe,
		() => recent,
		() => null,
	);
}

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
