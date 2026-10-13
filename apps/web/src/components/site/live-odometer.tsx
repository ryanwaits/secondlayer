"use client";

import { PUBLIC_API_URL } from "@/lib/public-api";
import { readEventsTotal } from "@/lib/status-fields";
import { useSyncExternalStore } from "react";
import { Odometer } from "./odometer";

const STATUS_URL = `${PUBLIC_API_URL}/public/status`;
const POLL_MS = 10_000;

/**
 * One poller per tab, shared by every live figure on the page. It reads only
 * while the tab is visible and someone is subscribed, and keeps the last good
 * value through failures.
 */
let events: number | null = null;
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
			const next = res.ok ? readEventsTotal(await res.json()) : null;
			if (next !== null && next !== events) {
				events = next;
				for (const l of listeners) l();
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

/**
 * Event total that keeps counting while the page is open. `initial` is the
 * server-rendered figure; the live value only ever moves it forward.
 */
export function LiveEventsOdometer({
	initial,
	label,
}: {
	initial: number;
	label: string;
}) {
	const live = useSyncExternalStore(
		subscribe,
		() => events,
		() => null,
	);
	return <Odometer value={Math.max(live ?? 0, initial)} label={label} />;
}
