"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const FLASH = "anchor-flash";
const HEADING = "h1, h2, h3, h4, h5, h6";

/** Briefly highlight where an anchor jump landed: the heading itself, or the
 *  first heading of the section it names. The scroll is near-instant, so the
 *  flash is what tells the eye where it ended up. */
function flash(hash: string) {
	if (hash.length < 2) return;
	const target = document.getElementById(decodeURIComponent(hash.slice(1)));
	if (!target) return;
	const el = target.matches(HEADING)
		? target
		: (target.querySelector<HTMLElement>(HEADING) ?? target);
	el.classList.remove(FLASH);
	// Restart the animation when the same anchor is clicked twice.
	void el.offsetWidth;
	el.classList.add(FLASH);
	el.addEventListener("animationend", () => el.classList.remove(FLASH), {
		once: true,
	});
}

/** Fires on load with a hash, on hash/history navigation, and on same-page
 *  link clicks (client-side links change the hash without a `hashchange`). */
export function AnchorFlash() {
	const pathname = usePathname();

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run on every page change
	useEffect(() => {
		const fromLocation = () => flash(window.location.hash);
		const fromClick = (e: MouseEvent) => {
			const a = (e.target as Element | null)?.closest<HTMLAnchorElement>(
				"a[href*='#']",
			);
			if (!a) return;
			const url = new URL(a.href, window.location.href);
			if (url.pathname !== window.location.pathname) return;
			requestAnimationFrame(() => flash(url.hash));
		};
		fromLocation();
		window.addEventListener("hashchange", fromLocation);
		window.addEventListener("popstate", fromLocation);
		document.addEventListener("click", fromClick);
		return () => {
			window.removeEventListener("hashchange", fromLocation);
			window.removeEventListener("popstate", fromLocation);
			document.removeEventListener("click", fromClick);
		};
	}, [pathname]);

	return null;
}
