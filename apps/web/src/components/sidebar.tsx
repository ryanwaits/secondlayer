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

	useEffect(() => {
		if (!toc || toc.length === 0) return;

		const ids = toc.map((item) => item.href.replace("#", ""));
		const firstId = ids[0] ?? "";

		let headerObserver: IntersectionObserver | null = null;
		let mutationObserver: MutationObserver | null = null;
		let observedIds = new Set<string>();
		let frame: number | null = null;

		function updateActiveSection() {
			frame = null;
			if (headerVisible.current) {
				setActiveId("");
				return;
			}

			const elements = ids
				.map((id) => document.getElementById(id))
				.filter(Boolean) as HTMLElement[];
			if (elements.length === 0) return;

			const page = document.documentElement;
			const bottomTolerance = 96;
			const atBottom =
				window.scrollY + window.innerHeight >=
				page.scrollHeight - bottomTolerance;

			if (atBottom) {
				setActiveId(ids[ids.length - 1] ?? "");
				return;
			}

			const activationLine = Math.min(window.innerHeight * 0.35, 220);
			let active = firstId;

			for (const element of elements) {
				if (element.getBoundingClientRect().top <= activationLine) {
					active = element.id;
				} else {
					break;
				}
			}

			setActiveId(active);
		}

		function scheduleActiveSectionUpdate() {
			if (frame !== null) return;
			frame = window.requestAnimationFrame(updateActiveSection);
		}

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
							scheduleActiveSectionUpdate();
						}
					},
					{ threshold: 0 },
				);
				headerObserver.observe(header);
			}

			// Observe any new elements that appeared
			for (const el of elements) {
				if (!observedIds.has(el.id)) {
					observedIds.add(el.id);
				}
			}

			scheduleActiveSectionUpdate();

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

		window.addEventListener("scroll", scheduleActiveSectionUpdate, {
			passive: true,
		});
		window.addEventListener("resize", scheduleActiveSectionUpdate);

		return () => {
			if (frame !== null) window.cancelAnimationFrame(frame);
			window.removeEventListener("scroll", scheduleActiveSectionUpdate);
			window.removeEventListener("resize", scheduleActiveSectionUpdate);
			headerObserver?.disconnect();
			mutationObserver?.disconnect();
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
