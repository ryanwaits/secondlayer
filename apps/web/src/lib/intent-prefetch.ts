"use client";

import { useRouter } from "next/navigation";
import { type MouseEvent, useCallback } from "react";

type Router = ReturnType<typeof useRouter>;
type PrefetchKind = NonNullable<Parameters<Router["prefetch"]>[1]>["kind"];

// Next's `kind: "full"`: fetch the page's payload with its data, not just the
// static shell. The enum lives in a private module, so the value is spelled.
const FULL = "full" as PrefetchKind;

/** Never prefetches on viewport entry: a list would fire one data read per row. */
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

/** The row's `<Link>` stays the keyboard and screen-reader target; this only widens the pointer target. */
export function useRowLink(href: string) {
	const router = useRouter();
	const intent = useIntentPrefetch();
	return {
		...intent(href),
		onClick: (event: MouseEvent<HTMLElement>) => {
			if (event.defaultPrevented) return;
			const target = event.target as HTMLElement;
			if (target.closest("a, input, select, textarea, label")) return;
			if (window.getSelection()?.toString()) return;
			if (event.metaKey || event.ctrlKey || event.button === 1) {
				window.open(href, "_blank", "noopener");
				return;
			}
			router.push(href);
		},
	};
}
