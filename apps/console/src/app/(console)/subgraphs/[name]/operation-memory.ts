"use client";

// Small browser-local bookkeeping for job state that outlives a render but
// isn't worth a server round-trip: which finished jobs the user has dismissed
// from the status pill.
//
// localStorage rather than sessionStorage on purpose — a backfill is started
// in one tab and often watched in another, and the page is reloaded while it
// runs. Both cases would otherwise resurrect a dismissed job.

const DISMISSED_KEY = "sl:ops-dismissed";

/** Bounds unbounded growth; far more ids than any session will produce. */
const MAX_IDS = 50;

function readIds(key: string): string[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = window.localStorage.getItem(key);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((v): v is string => typeof v === "string")
			: [];
	} catch {
		// Storage disabled/full or the value was corrupted by hand — degrade to
		// "remember nothing" rather than taking the pill down with us.
		return [];
	}
}

function appendId(key: string, id: string): void {
	if (typeof window === "undefined") return;
	const existing = readIds(key);
	if (existing.includes(id)) return;
	try {
		window.localStorage.setItem(
			key,
			JSON.stringify([...existing, id].slice(-MAX_IDS)),
		);
	} catch {}
}

export function readDismissedOperationIds(): Set<string> {
	return new Set(readIds(DISMISSED_KEY));
}

export function rememberOperationDismissed(id: string): void {
	appendId(DISMISSED_KEY, id);
}
