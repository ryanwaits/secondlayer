"use client";

import { useSyncExternalStore } from "react";

/** True when `query` matches. `serverValue` is what the server render (and
 *  hydration) assumes; callers should treat the narrow/inline rendering as the
 *  default. A wrong guess is corrected right after hydration. */
export function useMediaQuery(query: string, serverValue = false): boolean {
	return useSyncExternalStore(
		(cb) => {
			const mq = window.matchMedia(query);
			mq.addEventListener("change", cb);
			return () => mq.removeEventListener("change", cb);
		},
		() => window.matchMedia(query).matches,
		() => serverValue,
	);
}
