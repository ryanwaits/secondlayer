"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useDocsMode } from "./docs-mode";

/** Bottom-of-rail copy action — the topline "Copy page" button scrolls away,
 *  so the sticky rail keeps one within reach. Same payload: article innerText. */
function TocCopy() {
	const [copied, setCopied] = useState(false);
	return (
		<div className="docs-toc-foot">
			<button
				type="button"
				className="docs-toc-copy"
				onClick={() => {
					const el = document.getElementById("docs-article");
					if (!el) return;
					navigator.clipboard.writeText(el.innerText);
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				}}
			>
				<svg
					width="11"
					height="11"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					aria-hidden="true"
				>
					<rect x="5" y="5" width="9" height="9" rx="1.5" />
					<path d="M5 11H3.5A1.5 1.5 0 0 1 2 9.5V3.5A1.5 1.5 0 0 1 3.5 2h6A1.5 1.5 0 0 1 11 3.5V5" />
				</svg>
				{copied ? "Copied" : "Copy page"}
			</button>
		</div>
	);
}

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
			<TocCopy />
		</aside>
	);
}
