"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useDocsMode } from "./docs-mode";

interface Head {
	id: string;
	text: string;
	level: number;
}

/** Right-rail "On this page" — reads headings from the rendered article
 *  (rehype-slug gives stable ids) and highlights the active one on scroll. */
export function DocsToc() {
	const pathname = usePathname();
	const { mode } = useDocsMode();
	const [heads, setHeads] = useState<Head[]>([]);
	const [activeId, setActiveId] = useState("");

	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger — re-read headings on route change
	useEffect(() => {
		const article = document.getElementById("docs-article");
		if (!article) return;
		const found = Array.from(article.querySelectorAll("h2, h3")).map((h) => {
			if (!h.id) {
				h.id = (h.textContent ?? "")
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, "-")
					.replace(/^-|-$/g, "");
			}
			return {
				id: h.id,
				text: h.textContent ?? "",
				level: h.tagName === "H3" ? 3 : 2,
			};
		});
		setHeads(found);
		setActiveId(found[0]?.id ?? "");
	}, [pathname]);

	// Scrollspy: the topmost heading in view is the active one.
	useEffect(() => {
		if (heads.length === 0) return;
		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries.filter((e) => e.isIntersecting);
				if (visible.length === 0) return;
				const top = visible.reduce((a, b) =>
					a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
				);
				setActiveId(top.target.id);
			},
			{ rootMargin: "-80px 0px -65% 0px", threshold: 0 },
		);
		for (const h of heads) {
			const el = document.getElementById(h.id);
			if (el) observer.observe(el);
		}
		return () => observer.disconnect();
	}, [heads]);

	// Agent mode has its own layout — no right rail.
	if (mode === "agent") return null;
	if (heads.length === 0) return <aside className="docs-toc" />;

	return (
		<aside className="docs-toc">
			<div className="docs-toc-label">On this page</div>
			{heads.map((h) => {
				const cls = [
					h.level === 3 ? "h3" : "",
					h.id === activeId ? "active" : "",
				]
					.filter(Boolean)
					.join(" ");
				return (
					<a key={h.id} href={`#${h.id}`} className={cls || undefined}>
						{h.text}
					</a>
				);
			})}
		</aside>
	);
}
