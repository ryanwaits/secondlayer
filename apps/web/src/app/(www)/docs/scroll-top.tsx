"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Land at the true top whenever the docs route changes. Next's default
 * scroll-on-nav stops a few px short inside the persistent (www) layout with
 * the fixed top nav, so the page pills hide under the nav. A new page is new
 * content, so this jumps: a glide from the old position would only replay
 * the page you just left. One more jump on the next frame catches mobile,
 * where the dynamic address bar can resize the viewport mid-navigation.
 *
 * A URL naming an element on the page (`#section`) is left to the browser's
 * own jump; scrolling to 0 would throw away the link's target.
 */
export function DocsScrollTop() {
	const pathname = usePathname();
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger — settle scroll on route change
	useEffect(() => {
		const hash = decodeURIComponent(location.hash.slice(1));
		if (hash && document.getElementById(hash)) return;
		window.scrollTo({ top: 0, left: 0, behavior: "instant" });
		const frame = requestAnimationFrame(() => {
			if (window.scrollY !== 0) {
				window.scrollTo({ top: 0, left: 0, behavior: "instant" });
			}
		});
		return () => cancelAnimationFrame(frame);
	}, [pathname]);
	return null;
}
