"use client";

import {
	type ReactNode,
	createContext,
	useContext,
	useSyncExternalStore,
} from "react";
import { type OpenChoices, writeOpenChoices } from "./insight-open";

const EMPTY: OpenChoices = {};
let choices: OpenChoices | null = null;
const listeners = new Set<() => void>();

const snapshot = (): OpenChoices => choices ?? EMPTY;

function subscribe(l: () => void) {
	listeners.add(l);
	return () => listeners.delete(l);
}

const SeedContext = createContext<OpenChoices>(EMPTY);

export function OpenChoicesSeed({
	saved,
	children,
}: {
	saved: OpenChoices;
	children: ReactNode;
}) {
	return <SeedContext.Provider value={saved}>{children}</SeedContext.Provider>;
}

/** The server never writes the module store: it is shared across requests. */
export function useOpenChoices(): OpenChoices {
	const saved = useContext(SeedContext);
	if (typeof window !== "undefined" && choices === null) choices = saved;
	return useSyncExternalStore(subscribe, snapshot, () => saved);
}

export function setOpenChoices(updates: ReadonlyArray<[string, boolean]>) {
	const next: Record<string, boolean> = { ...snapshot() };
	for (const [id, open] of updates) {
		// Delete first so the touched ones sit newest when the cookie is capped.
		delete next[id];
		next[id] = open;
	}
	choices = next;
	writeOpenChoices(next);
	for (const l of listeners) l();
}
