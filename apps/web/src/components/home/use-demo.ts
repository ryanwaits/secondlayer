"use client";

import { useEffect, useRef, useState } from "react";

/** True once the element has scrolled into view (threshold 0.35). */
export function useInViewOnce<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	const [inView, setInView] = useState(false);
	useEffect(() => {
		const el = ref.current;
		if (!el || inView) return;
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting) {
						setInView(true);
						io.disconnect();
					}
				}
			},
			{ threshold: 0.35 },
		);
		io.observe(el);
		return () => io.disconnect();
	}, [inView]);
	return { ref, inView };
}

export function usePrefersReducedMotion(): boolean {
	const [reduced, setReduced] = useState(false);
	useEffect(() => {
		const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
		setReduced(mq.matches);
		const on = (e: MediaQueryListEvent) => setReduced(e.matches);
		mq.addEventListener("change", on);
		return () => mq.removeEventListener("change", on);
	}, []);
	return reduced;
}

/**
 * Scripted demo cycle. `marks` are millisecond offsets within one cycle;
 * `stage` is the index of the last mark passed (-1 at cycle start), so a
 * pane derives its scene from `stage`. Replays every `loopMs`.
 *
 * Reduced motion → stage pinned to the final mark, no timers (static
 * end-state). Loop pauses while the tab is hidden.
 */
export function useStagedCycle(
	active: boolean,
	marks: number[],
	loopMs: number,
): { stage: number; cycle: number } {
	const reduced = usePrefersReducedMotion();
	const [stage, setStage] = useState(-1);
	const [cycle, setCycle] = useState(0);

	useEffect(() => {
		if (!active || reduced) return;
		let timeouts: ReturnType<typeof setTimeout>[] = [];
		let loop: ReturnType<typeof setInterval> | null = null;

		function runCycle() {
			if (document.hidden) return;
			setStage(-1);
			setCycle((c) => c + 1);
			timeouts = marks.map((at, i) =>
				setTimeout(() => setStage((s) => Math.max(s, i)), at),
			);
		}
		runCycle();
		loop = setInterval(() => {
			for (const t of timeouts) clearTimeout(t);
			runCycle();
		}, loopMs);
		return () => {
			for (const t of timeouts) clearTimeout(t);
			if (loop) clearInterval(loop);
		};
		// every pane passes a module-constant marks array, so the reference
		// is stable as a dependency
	}, [active, reduced, loopMs, marks]);

	if (reduced || !active) {
		// static final scene (also the pre-scroll SSR state for reduced motion;
		// pre-scroll motion state renders stage -1 via `active=false → -1`)
		return { stage: reduced ? marks.length - 1 : -1, cycle: 0 };
	}
	return { stage, cycle };
}

/** Evenly spaced marks helper: start, start+step, … (n marks). */
export function everyMs(start: number, step: number, n: number): number[] {
	return Array.from({ length: n }, (_, i) => start + i * step);
}
