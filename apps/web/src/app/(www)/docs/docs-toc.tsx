"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PageActions } from "./page-actions";

const API_REFERENCE = "/docs/api-reference";
const VIEW_KEY = "docs-apiref-examples";
/** The rail is hidden at and below this width; full view needs the rail. */
const RAIL_QUERY = "(min-width: 1181px)";

/** "The Reorg object" lists as "Reorg" in the rail and the sidebar. */
export function bareObjectTitle(title: string): string {
	return title.replace(/^The (.+) object$/, "$1");
}

interface Head {
	/** The id the rail links to and watches. */
	id: string;
	text: string;
	level: number;
}

/**
 * The API reference's "Full view": prose left, sticky request and response
 * right, the rail narrowed to icons. Remembered per reader (storage is
 * optional); `data-view` on the shell is what the CSS reads. Only while the
 * rail is wide enough to show; below that the page is one column.
 */
function useFullView(enabled: boolean) {
	const [on, setOn] = useState(false);

	useEffect(() => {
		if (!enabled) return;
		try {
			setOn(localStorage.getItem(VIEW_KEY) === "split");
		} catch {
			// Blocked storage: single column until toggled.
		}
	}, [enabled]);

	useEffect(() => {
		if (!enabled) return;
		const shell = document.querySelector(".docs-shell");
		const wide = window.matchMedia(RAIL_QUERY);
		const apply = () => {
			if (on && wide.matches) shell?.setAttribute("data-view", "split");
			else shell?.removeAttribute("data-view");
		};
		apply();
		wide.addEventListener("change", apply);
		return () => {
			wide.removeEventListener("change", apply);
			shell?.removeAttribute("data-view");
		};
	}, [enabled, on]);

	const toggle = useCallback(() => {
		setOn((cur) => {
			try {
				localStorage.setItem(VIEW_KEY, cur ? "single" : "split");
			} catch {
				// Not persisted; the choice still applies to this visit.
			}
			return !cur;
		});
	}, []);

	useEffect(() => {
		if (!enabled) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "f" && e.key !== "F") return;
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (!window.matchMedia(RAIL_QUERY).matches) return;
			const t = e.target as HTMLElement | null;
			if (
				t?.isContentEditable ||
				t?.tagName === "INPUT" ||
				t?.tagName === "TEXTAREA" ||
				t?.tagName === "SELECT"
			)
				return;
			e.preventDefault();
			toggle();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [enabled, toggle]);

	return { on, toggle };
}

/** Right-rail "On this page" — reads headings from the rendered article
 *  (rehype-slug gives stable ids) and highlights the active one on scroll;
 *  page actions sit below it. */
export function DocsToc() {
	const pathname = usePathname();
	const [heads, setHeads] = useState<Head[]>([]);
	const [activeId, setActiveId] = useState("");
	const onReference = pathname === API_REFERENCE;
	const fullView = useFullView(onReference);

	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger — re-read headings on route change
	useEffect(() => {
		const article = document.getElementById("docs-article");
		if (!article) return;
		const found = Array.from(article.querySelectorAll("h2, h3")).map((h) => {
			// A reference section's anchor lives on its <section>, not its title.
			const section = h.closest<HTMLElement>("section.apiref-section");
			if (!section && !h.id) {
				h.id = (h.textContent ?? "")
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, "-")
					.replace(/^-|-$/g, "");
			}
			const text = h.textContent ?? "";
			return {
				id: section?.id ?? h.id,
				text: section
					? bareObjectTitle(text)
					: h.classList.contains("apiref-tag-title")
						? text.charAt(0).toUpperCase() + text.slice(1)
						: text,
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

	return (
		<aside className="docs-toc" aria-label="On this page">
			{heads.length > 0 ? (
				<div className="docs-toc-list">
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
				</div>
			) : null}
			<PageActions
				fullView={onReference ? fullView : undefined}
				compact={onReference && fullView.on}
			/>
		</aside>
	);
}
