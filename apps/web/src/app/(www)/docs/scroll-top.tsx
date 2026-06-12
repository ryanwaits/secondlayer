"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Settle the window at the true top whenever the docs route changes. Next's
 * default scroll-on-nav lands a few px short inside the persistent (www) layout
 * with the fixed top nav, so the breadcrumb hides under the nav. We finish the
 * scroll to 0 — smoothly, so the navigation glide is preserved (an instant jump
 * killed it). Reduced-motion users get an instant settle.
 */
export function DocsScrollTop() {
	const pathname = usePathname();
	useEffect(() => {
		const reduced = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		window.scrollTo({
			top: 0,
			left: 0,
			behavior: reduced ? "instant" : "smooth",
		});
	}, [pathname]);
	return null;
}
