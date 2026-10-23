"use client";

import { refreshKeys } from "@/lib/account-data";
import type { AccountStage } from "@/lib/onboarding";
import type { ApiKey } from "@/lib/types";
import { poll } from "@/lib/webhooks-store";
import { useEffect, useRef, useState } from "react";
import { countedKeys } from "../keys/key-view";

/** How often keys refetch while the page waits for a first read; null means never. */
export function firstReadPollMs(stage: AccountStage): number | null {
	return stage === "no_reads" ? 5000 : null;
}

/** The key whose `lastUsedAt` went from null to set between two loads, or null. */
export function firstReadKey(prev: ApiKey[], next: ApiKey[]): ApiKey | null {
	const unread = new Set(
		prev.filter((k) => k.lastUsedAt === null).map((k) => k.id),
	);
	return next.find((k) => k.lastUsedAt !== null && unread.has(k.id)) ?? null;
}

export interface FirstRead {
	/** When the read happened. */
	at: Date;
	/** The key that made it. */
	keyName: string;
}

/**
 * Keeps keys current while a new account waits on its first read, so the page
 * flips without a reload. Polls only while the tab is visible and only in
 * `no_reads`. Refetches on focus there and in `no_key` (a key made by
 * `sl login` in a terminal). Returns the read once it lands.
 */
export function useFirstRead(
	stage: AccountStage,
	keys: ApiKey[] | null,
): FirstRead | null {
	const ms = firstReadPollMs(stage);
	useEffect(() => {
		if (ms === null) return;
		return poll(async () => {
			await refreshKeys();
			return {};
		}, ms);
	}, [ms]);

	const watching = stage === "no_key" || stage === "no_reads";
	useEffect(() => {
		if (!watching) return;
		const refetch = () => {
			if (document.visibilityState === "visible") refreshKeys();
		};
		document.addEventListener("visibilitychange", refetch);
		window.addEventListener("focus", refetch);
		return () => {
			document.removeEventListener("visibilitychange", refetch);
			window.removeEventListener("focus", refetch);
		};
	}, [watching]);

	const [read, setRead] = useState<FirstRead | null>(null);
	const previous = useRef<ApiKey[] | null>(null);
	useEffect(() => {
		if (keys === null) return;
		const before = previous.current;
		previous.current = keys;
		if (before === null || stage !== "reading") return;
		const now = new Date();
		const hit = firstReadKey(countedKeys(before, now), countedKeys(keys, now));
		if (hit?.lastUsedAt) {
			setRead({ at: new Date(hit.lastUsedAt), keyName: hit.name });
		}
	}, [keys, stage]);
	return read;
}
