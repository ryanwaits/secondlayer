"use client";

import { useEffect } from "react";

/** Native smooth scrolling runs roughly 500 to 800 ms and can't be tuned in
 *  CSS. These bounds are about twice as fast. */
const MIN_MS = 140;
const MAX_MS = 380;

function durationFor(distance: number): number {
	return Math.min(MAX_MS, MIN_MS + Math.abs(distance) * 0.06);
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * Same-page `#` links scroll about twice as fast as the browser's own smooth
 * scroll, site-wide.
 *
 * The browser still does the navigating: we let it jump to the hash instantly
 * (so history, `:target` and `scroll-padding-top` behave exactly as before),
 * read where it landed, put the page back in the same frame, then animate
 * there ourselves. Reduced-motion readers keep the instant jump.
 */
export function FastAnchorScroll() {
	useEffect(() => {
		let frame = 0;

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
			if (!document.getElementById(id)) return;

			event.preventDefault();
			const root = document.documentElement;
			const startY = window.scrollY;
			const reduced = window.matchMedia(
				"(prefers-reduced-motion: reduce)",
			).matches;

			// Let the browser jump (records the hash), then note the target.
			root.style.scrollBehavior = "auto";
			if (location.hash === url.hash) {
				document.getElementById(id)?.scrollIntoView();
			} else {
				location.hash = url.hash;
			}
			const targetY = window.scrollY;
			if (reduced || targetY === startY) {
				root.style.scrollBehavior = "";
				return;
			}

			// Back to where we were, same frame, then glide.
			window.scrollTo(0, startY);
			cancelAnimationFrame(frame);
			const distance = targetY - startY;
			const duration = durationFor(distance);
			const started = performance.now();
			const step = (now: number) => {
				const t = Math.min(1, (now - started) / duration);
				window.scrollTo(0, startY + distance * easeOutCubic(t));
				if (t < 1) {
					frame = requestAnimationFrame(step);
				} else {
					root.style.scrollBehavior = "";
				}
			};
			frame = requestAnimationFrame(step);
		}

		document.addEventListener("click", onClick);
		return () => {
			document.removeEventListener("click", onClick);
			cancelAnimationFrame(frame);
		};
	}, []);

	return null;
}
