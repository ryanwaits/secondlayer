"use client";

import { getPost, longDate } from "@/lib/writing";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Entry = { id: string; title: string };

/**
 * The post rail, sticky right of the column: the post's number, date and
 * length, and its sections and figures. Scroll
 * position lights the current section and the current figure, each in its
 * own list. Sections come from the article's h2 ids, figures from its
 * FigShell titles, so the rail always matches the page. Below 760px the rail hides and PostHeader's
 * inline line carries the date and length.
 */
export function PostRail() {
	const pathname = usePathname();
	const post = getPost(pathname.split("/").filter(Boolean)[1] ?? "");
	const [sections, setSections] = useState<Entry[]>([]);
	const [figureList, setFigureList] = useState<Entry[]>([]);
	const [section, setSection] = useState<string | null>(null);
	const [figure, setFigure] = useState<string | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger — each post reads its own headings
	useEffect(() => {
		const article = document.getElementById("writing-article");
		const heads = Array.from(
			article?.querySelectorAll<HTMLElement>("h2[id]") ?? [],
		);
		setSections(
			heads.map((h) => ({ id: h.id, title: h.textContent?.trim() ?? "" })),
		);
		const figures = Array.from(
			article?.querySelectorAll<HTMLElement>("figure.fig[id]") ?? [],
		);
		setFigureList(
			figures.map((f) => ({
				id: f.id,
				title: f.querySelector(".fig-title")?.textContent?.trim() ?? "",
			})),
		);
		// Each list lights on its own: the section is the last heading above the
		// reading line (the first one until then); the figure, the last one
		// whose top has reached mid-screen.
		let frame = 0;
		const track = () => {
			frame = 0;
			const above = (el: HTMLElement, line: number) =>
				el.getBoundingClientRect().top < line;
			setSection(
				(heads.filter((h) => above(h, 120)).pop() ?? heads[0])?.id ?? null,
			);
			setFigure(
				figures.filter((f) => above(f, window.innerHeight / 2)).pop()?.id ??
					null,
			);
		};
		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(track);
		};
		track();
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
		};
	}, [pathname]);

	if (!post) return <aside className="writing-rail" aria-hidden="true" />;

	return (
		<aside className="writing-rail" aria-label="Post details">
			<div>
				<span className="k">No. {String(post.number).padStart(2, "0")}</span>
				{longDate(post.date)}
				<br />
				{post.readingTime} read
			</div>
			{sections.length > 0 && (
				<nav aria-label="Sections">
					<span className="k">Sections</span>
					{sections.map((s) => (
						<a
							key={s.id}
							href={`#${s.id}`}
							className={section === s.id ? "on" : undefined}
						>
							{s.title}
						</a>
					))}
				</nav>
			)}
			{figureList.length > 0 && (
				<nav aria-label="Figures">
					<span className="k">Figures</span>
					{figureList.map((f, i) => (
						<a
							key={f.id}
							href={`#${f.id}`}
							className={figure === f.id ? "on" : undefined}
						>
							{i + 1} · {f.title}
						</a>
					))}
				</nav>
			)}
		</aside>
	);
}
