"use client";

import { useSyncExternalStore } from "react";

/**
 * Webhooks with a requeue in flight, so the header pill can show "Requeuing"
 * from any screen until the call resolves. A requeue sends events straight
 * back out, so it has no progress to report, only an end.
 */
let active: readonly string[] = [];
const listeners = new Set<() => void>();

export function setRequeuing(webhookId: string, on: boolean): void {
	const has = active.includes(webhookId);
	if (on === has) return;
	active = on
		? [...active, webhookId]
		: active.filter((id) => id !== webhookId);
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

const EMPTY: readonly string[] = [];

export function useRequeuing(): readonly string[] {
	return useSyncExternalStore(
		subscribe,
		() => active,
		() => EMPTY,
	);
}
