"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Settle the window at the true top whenever the docs route changes. Next's
 * default scroll-on-nav lands a few px short inside the persistent (www) layout
 * with the fixed top nav, so the breadcrumb hides under the nav. We finish the
 * scroll to 0 — smoothly, so the navigation glide is preserved (an instant jump
 * killed it). Reduced-motion users get an instant settle.
 *
 * On mobile the smooth glide runs over a much longer distance (e.g. a footer
 * link) and the browser cuts it short / the dynamic address-bar viewport shifts
 * mid-animation, so it still settles a few px short. Once the smooth scroll ends
 * we snap to true 0 — a no-op on desktop (already there), the final settle on
 * mobile. A timeout backstops `scrollend` for browsers that interrupt it.
 */
export function DocsScrollTop() {
	const pathname = usePathname();
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger — settle scroll on route change
	useEffect(() => {
		const reduced = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		window.scrollTo({
			top: 0,
			left: 0,
			behavior: reduced ? "instant" : "smooth",
		});
		if (reduced) return;

		let settled = false;
		const settle = () => {
			if (settled) return;
			settled = true;
			window.removeEventListener("scrollend", settle);
			clearTimeout(timer);
			if (window.scrollY !== 0) {
				window.scrollTo({ top: 0, left: 0, behavior: "instant" });
			}
		};
		window.addEventListener("scrollend", settle);
		const timer = setTimeout(settle, 700);
		return () => {
			window.removeEventListener("scrollend", settle);
			clearTimeout(timer);
		};
	}, [pathname]);
	return null;
}
