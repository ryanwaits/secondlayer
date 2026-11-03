"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

type Router = ReturnType<typeof useRouter>;
type PrefetchKind = NonNullable<Parameters<Router["prefetch"]>[1]>["kind"];

// Next's `kind: "full"`: fetch the page's payload with its data, not just the
// static shell. The enum lives in a private module, so the value is spelled.
const FULL = "full" as PrefetchKind;

/**
 * Starts a full prefetch of a link's page when the pointer or focus lands on
 * it (or a finger touches it), a few hundred milliseconds before the click.
 * These pages render their data on the server, so the prefetched payload
 * carries it and the navigation paints without waiting. Never prefetches on
 * viewport entry: a list would fire one data read per row. Pair it with
 * `<Link prefetch={false}>`. `alsoOnIntent` runs first, on the same events.
 */
export function useIntentPrefetch(): (
	href: string,
	alsoOnIntent?: () => void,
) => {
	onPointerEnter: () => void;
	onFocus: () => void;
	onTouchStart: () => void;
} {
	const router = useRouter();
	return useCallback(
		(href: string, alsoOnIntent?: () => void) => {
			const prefetch = () => {
				alsoOnIntent?.();
				router.prefetch(href, { kind: FULL });
			};
			return {
				onPointerEnter: prefetch,
				onFocus: prefetch,
				onTouchStart: prefetch,
			};
		},
		[router],
	);
}
