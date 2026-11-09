"use client";

import {
	type ReactNode,
	createContext,
	useContext,
	useSyncExternalStore,
} from "react";
import { type OpenChoices, writeOpenChoices } from "./insight-open";

/**
 * Which insights the reader showed or hid, shared by every insight surface
 * under /account. A new insight opens by its own rule; once the reader shows
 * or hides it, that choice sticks across pages and visits (the cookie).
 */

const EMPTY: OpenChoices = {};
/** Null until the first client render seeds it from the cookie the server read. */
let choices: OpenChoices | null = null;
const listeners = new Set<() => void>();

const snapshot = (): OpenChoices => choices ?? EMPTY;

function subscribe(l: () => void) {
	listeners.add(l);
	return () => listeners.delete(l);
}

const SeedContext = createContext<OpenChoices>(EMPTY);

/** Hands the cookie the layout read to every `useOpenChoices()` below it. */
export function OpenChoicesSeed({
	saved,
	children,
}: {
	saved: OpenChoices;
	children: ReactNode;
}) {
	return <SeedContext.Provider value={saved}>{children}</SeedContext.Provider>;
}

/** The saved choices. The server render and hydration read the seed; the
 *  client store starts from it once and moves on its own after that. The
 *  server never writes the module store: it is shared across requests. */
export function useOpenChoices(): OpenChoices {
	const saved = useContext(SeedContext);
	if (typeof window !== "undefined" && choices === null) choices = saved;
	return useSyncExternalStore(subscribe, snapshot, () => saved);
}

/** Records the reader's choices, in order, and saves them to the cookie. */
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
