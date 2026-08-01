"use client";

import { useEffect, useState } from "react";

/**
 * The post meta rail: pinned in the left page margin (position: fixed via
 * CSS, ≥1180px only) so navigation stays available while scrolling. An
 * IntersectionObserver tracks which figure is on screen and lights its
 * row, docs-TOC style. Below the breakpoint the rail is display: none and
 * PostHeader's inline eyebrow + meta carry the same facts.
 */
export function PostRail({
	number,
	date,
	readingTime,
	figures,
	tags,
}: {
	number: string;
	date: string;
	readingTime: string;
	figures?: string[];
	tags: string[];
}) {
	const [active, setActive] = useState<number | null>(null);

	useEffect(() => {
		if (!figures?.length) return;
		const els = figures
			.map((_, i) => document.getElementById(`fig-${i + 1}`))
			.filter((el): el is HTMLElement => el !== null);
		if (!els.length) return;
		const io = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						setActive(Number(entry.target.id.replace("fig-", "")));
					}
				}
			},
			{ rootMargin: "-80px 0px -55% 0px" },
		);
		for (const el of els) io.observe(el);
		return () => io.disconnect();
	}, [figures]);

	return (
		<aside className="writing-rail" aria-label="Post details">
			<span className="k">Writings</span>
			<span className="no">№ {number}</span>
			<span>{date}</span>
			<span>{readingTime} read</span>
			{figures && figures.length > 0 && (
				<>
					<span className="k">Figures</span>
					{figures.map((title, i) => (
						<a
							key={title}
							className={active === i + 1 ? "fig-ln on" : "fig-ln"}
							href={`#fig-${i + 1}`}
						>
							<b>{i + 1}</b> · {title}
						</a>
					))}
				</>
			)}
			<span className="k">Tags</span>
			<span>{tags.join(" · ")}</span>
		</aside>
	);
}
