"use client";

import { scrollWindowTo } from "@/lib/scroll";
import { useEffect } from "react";

/**
 * Same-page `#` links move at once: a short glide for nearby targets, a jump
 * for far ones (see lib/scroll).
 *
 * The browser still does the navigating: we let it jump to the hash (so
 * history, `:target` and `scroll-padding-top` behave exactly as before), read
 * where it landed, put the page back in the same frame, then glide there.
 */
export function FastAnchorScroll() {
	useEffect(() => {
		function onClick(event: MouseEvent) {
			if (
				event.defaultPrevented ||
				event.button !== 0 ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey
			) {
				return;
			}
			const link = (event.target as Element | null)?.closest?.("a[href]");
			if (!(link instanceof HTMLAnchorElement) || link.target === "_blank") {
				return;
			}
			const url = new URL(link.href, location.href);
			if (
				!url.hash ||
				url.origin !== location.origin ||
				url.pathname !== location.pathname ||
				url.search !== location.search
			) {
				return;
			}
			const id = decodeURIComponent(url.hash.slice(1));
			const target = document.getElementById(id);
			if (!target) return;

			event.preventDefault();
			const startY = window.scrollY;
			// Let the browser jump (records the hash), then note the target.
			if (location.hash === url.hash) target.scrollIntoView();
			else location.hash = url.hash;
			const targetY = window.scrollY;
			if (targetY === startY) return;
			// Back to where we were, same frame, then move.
			window.scrollTo({ top: startY, left: 0, behavior: "instant" });
			scrollWindowTo(targetY);
		}

		document.addEventListener("click", onClick);
		return () => document.removeEventListener("click", onClick);
	}, []);

	return null;
}
