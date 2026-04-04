"use client";

import { useSiteHref } from "@/lib/auth";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export interface TocItem {
	label: string;
	href: string;
}

interface SidebarProps {
	title?: string;
	toc?: TocItem[];
	backHref?: string;
	backLabel?: string;
}

export function Sidebar({ title, toc, backHref, backLabel }: SidebarProps) {
	const [activeId, setActiveId] = useState<string>("");
	const [titleVisible, setTitleVisible] = useState(false);
	const headerVisible = useRef(true);
	const visibleSections = useRef(new Set<string>());

	useEffect(() => {
		if (!toc || toc.length === 0) return;

		const ids = toc.map((item) => item.href.replace("#", ""));
		const firstId = ids[0] ?? "";

		let headerObserver: IntersectionObserver | null = null;
		let sectionObserver: IntersectionObserver | null = null;
		let mutationObserver: MutationObserver | null = null;
		let observedIds = new Set<string>();

		function setup() {
			const header = document.querySelector(".page-header");
			const elements = ids
				.map((id) => document.getElementById(id))
				.filter(Boolean) as HTMLElement[];

			// Header observer — controls title visibility and resets state at top
			if (header && !headerObserver) {
				headerObserver = new IntersectionObserver(
					([entry]) => {
						headerVisible.current = entry.isIntersecting;
						setTitleVisible(!entry.isIntersecting);

						if (entry.isIntersecting) {
							setActiveId("");
						} else if (firstId) {
							setActiveId((prev) => prev || firstId);
						}
					},
					{ threshold: 0 },
				);
				headerObserver.observe(header);
			}

			// Section observer — only updates active when header is out of view
			if (!sectionObserver) {
				sectionObserver = new IntersectionObserver(
					(entries) => {
						for (const entry of entries) {
							if (entry.isIntersecting) {
								visibleSections.current.add(entry.target.id);
							} else {
								visibleSections.current.delete(entry.target.id);
							}
						}

						if (headerVisible.current) return;

						const active = ids.find((id) => visibleSections.current.has(id));
						if (active) {
							setActiveId(active);
						}
					},
					{ rootMargin: "0px 0px -60% 0px", threshold: 0 },
				);
			}

			// Observe any new elements that appeared
			for (const el of elements) {
				if (!observedIds.has(el.id)) {
					sectionObserver.observe(el);
					observedIds.add(el.id);
				}
			}

			// Stop watching DOM once all sections are found
			if (observedIds.size === ids.length && mutationObserver) {
				mutationObserver.disconnect();
				mutationObserver = null;
			}
		}

		setup();

		// If not all elements found yet, watch for DOM changes
		if (observedIds.size < ids.length) {
			mutationObserver = new MutationObserver(() => setup());
			mutationObserver.observe(document.body, {
				childList: true,
				subtree: true,
			});
		}

		return () => {
			headerObserver?.disconnect();
			sectionObserver?.disconnect();
			mutationObserver?.disconnect();
			visibleSections.current.clear();
			observedIds = new Set();
		};
	}, [toc]);

	const indexHref = useSiteHref("/");
	const resolvedBackHref = backHref ?? indexHref;
	const resolvedBackLabel = backLabel ?? "Index";

	return (
		<aside className="sidebar">
			<Link href={resolvedBackHref} className="back-link">
				↩ {resolvedBackLabel}
			</Link>

			{title && (
				<button
					type="button"
					onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
					className={`nav-sidebar-title ${titleVisible ? "visible" : ""} ${activeId ? "muted" : ""}`}
				>
					{title}
				</button>
			)}

			{toc && toc.length > 0 && (
				<ul className="nav-list">
					{toc.map((item) => {
						const id = item.href.replace("#", "");
						return (
							<li key={item.href}>
								<a href={item.href} className={activeId === id ? "active" : ""}>
									{item.label}
								</a>
							</li>
						);
					})}
				</ul>
			)}
		</aside>
	);
}
