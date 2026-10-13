/**
 * Page scrolls that feel instant. Native smooth scrolling runs 500 to 800 ms
 * and can't be tuned, so in-page moves glide for at most 180 ms (ease-out:
 * the jump is visible at once and settles), and anything farther than about
 * two screens jumps, since a long glide only paints content nobody reads.
 * Reduced-motion readers always jump.
 */

const MIN_MS = 90;
const MAX_MS = 180;
const MAX_GLIDE_SCREENS = 2;

const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;

let frame = 0;

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Scroll the window to `top`, gliding briefly for short moves. */
export function scrollWindowTo(top: number): void {
	cancelAnimationFrame(frame);
	const startY = window.scrollY;
	const distance = top - startY;
	if (
		distance === 0 ||
		prefersReducedMotion() ||
		Math.abs(distance) > window.innerHeight * MAX_GLIDE_SCREENS
	) {
		window.scrollTo({ top, left: 0, behavior: "instant" });
		return;
	}
	const duration = Math.min(MAX_MS, MIN_MS + Math.abs(distance) * 0.06);
	const started = performance.now();
	const step = (now: number) => {
		const t = Math.min(1, (now - started) / duration);
		window.scrollTo({
			top: startY + distance * easeOutQuart(t),
			left: 0,
			behavior: "instant",
		});
		if (t < 1) frame = requestAnimationFrame(step);
	};
	frame = requestAnimationFrame(step);
}

/** Scroll so `el` sits at the top, honouring `scroll-padding-top`. */
export function scrollToElement(el: Element): void {
	const pad =
		Number.parseFloat(
			getComputedStyle(document.documentElement).scrollPaddingTop,
		) || 0;
	scrollWindowTo(el.getBoundingClientRect().top + window.scrollY - pad);
}
