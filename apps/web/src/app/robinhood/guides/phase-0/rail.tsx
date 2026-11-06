"use client";

import { activeHeading, isAtScrollEnd } from "@/app/(www)/docs/outline-spy";
import { useEffect, useRef, useState } from "react";

export type RailStep = { id: string; n: string; title: string; who: string };

/** A section counts as being read once its top passes this far down. */
const SPY_LINE = 120;

/**
 * The guide's step list. Lights the section being read (the docs outline's
 * rule) and keeps that step in view: on a phone the rail is a sideways strip,
 * so it scrolls the active chip in, by the least distance, without moving the
 * page.
 */
export function GuideRail({ steps }: { steps: readonly RailStep[] }) {
	const [active, setActive] = useState(steps[0]?.id);
	const listRef = useRef<HTMLOListElement>(null);

	useEffect(() => {
		let frame = 0;
		const read = () => {
			frame = 0;
			const tops = steps.map(
				(s) => document.getElementById(s.id)?.getBoundingClientRect().top ?? 0,
			);
			const at = activeHeading(
				tops,
				SPY_LINE,
				isAtScrollEnd(
					window.scrollY,
					window.innerHeight,
					document.documentElement.scrollHeight,
				),
			);
			if (at >= 0) setActive(steps[at].id);
		};
		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(read);
		};
		read();
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		return () => {
			if (frame) cancelAnimationFrame(frame);
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
		};
	}, [steps]);

	useEffect(() => {
		const list = listRef.current;
		const row = list?.querySelector<HTMLElement>(`[data-step="${active}"]`);
		if (!list || !row) return;
		const l = list.getBoundingClientRect();
		const r = row.getBoundingClientRect();
		if (r.left < l.left) list.scrollLeft -= l.left - r.left + 8;
		else if (r.right > l.right) list.scrollLeft += r.right - l.right + 8;
		if (r.top < l.top) list.scrollTop -= l.top - r.top + 8;
		else if (r.bottom > l.bottom) list.scrollTop += r.bottom - l.bottom + 8;
	}, [active]);

	return (
		<nav className="rh-g-rail" aria-label="Steps">
			<ol ref={listRef}>
				{steps.map((s) => (
					<li key={s.id}>
						<a
							href={`#${s.id}`}
							data-step={s.id}
							aria-current={s.id === active ? "step" : undefined}
						>
							<span className="rh-g-n mono">{s.n}</span>
							<span>{s.title}</span>
							<span className="rh-g-who mono">{s.who}</span>
						</a>
					</li>
				))}
			</ol>
		</nav>
	);
}
