"use client";

import { useSyncExternalStore } from "react";

/** True when `query` matches; false during SSR (callers should treat the
 *  narrow/inline rendering as the server default). */
export function useMediaQuery(query: string): boolean {
	return useSyncExternalStore(
		(cb) => {
			const mq = window.matchMedia(query);
			mq.addEventListener("change", cb);
			return () => mq.removeEventListener("change", cb);
		},
		() => window.matchMedia(query).matches,
		() => false,
	);
}
