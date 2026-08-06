"use client";

import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { useEffect } from "react";

/**
 * Makes 404s visible to analytics.
 *
 * A not-found boundary renders an ordinary page, so posthog-js captures an
 * ordinary `$pageview` — indistinguishable from a route that worked. Client
 * analytics never sees an HTTP status, so without this a broken route produces
 * no signal at all and surfaces as a support ticket instead of a metric.
 *
 * `referrer` is the useful half: it names the page carrying the broken link,
 * which is what you actually need to fix it. `boundary` says which not-found
 * rendered, separating "no such subgraph" from "no such route".
 */
export function NotFoundTracker({ boundary }: { boundary: string }) {
	const pathname = usePathname();

	useEffect(() => {
		posthog.capture("page_not_found", {
			path: pathname,
			boundary,
			referrer: document.referrer || null,
		});
	}, [pathname, boundary]);

	return null;
}
