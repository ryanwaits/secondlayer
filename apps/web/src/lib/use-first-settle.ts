"use client";

import { useEffect, useState } from "react";

/** How long a screen waits for its first data before painting what it has. */
export const FIRST_SETTLE_MS = 1200;

/**
 * True once `settled` has been true, or `maxWaitMs` after mount, whichever
 * comes first. It latches: a later refetch never puts the screen back to its
 * skeleton. A screen holds one skeleton until this is true, then paints
 * everything at once, so rows don't land one by one and push each other down.
 * A warm store (navigating back) is settled on the first render: no skeleton.
 */
export function useFirstSettle(
	settled: boolean,
	maxWaitMs = FIRST_SETTLE_MS,
): boolean {
	const [latched, setLatched] = useState(settled);
	useEffect(() => {
		if (latched) return;
		if (settled) {
			setLatched(true);
			return;
		}
		const timer = setTimeout(() => setLatched(true), maxWaitMs);
		return () => clearTimeout(timer);
	}, [settled, latched, maxWaitMs]);
	return latched || settled;
}
