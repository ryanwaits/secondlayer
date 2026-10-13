"use client";

import { githubSourcePath, markdownPath } from "@/lib/docs-agent";
import { copyMarkdown } from "@/lib/docs-clipboard";
import { GITHUB_URL } from "@/lib/site";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { docsNavPages } from "./nav";

const FLASH_MS = 1500;

function lookup(pathname: string) {
	const pages = docsNavPages();
	const at = pages.findIndex((p) => p.href === pathname);
	if (at < 0) return null;
	const page = pages[at];
	return {
		group: page.group,
		title: page.title,
		prev: pages[at - 1],
		next: pages[at + 1],
	};
}

/** "Copy for agent" and ".md" for pages with a markdown twin: ghost pills
 *  right of the breadcrumb. */
function PageActions({ pathname }: { pathname: string }) {
	const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
	const timer = useRef(0);

	useEffect(() => () => clearTimeout(timer.current), []);

	// Only pages in the sidebar have a markdown twin, so the pills that point
	// at one are left off elsewhere.
	const hasMarkdown = docsNavPages().some(
		(page) => page.href === pathname.replace(/\/$/, ""),
	);
	if (!hasMarkdown) return null;

	const md = markdownPath(pathname);
	const label =
		copy === "done"
			? "Copied"
			: copy === "failed"
				? "Couldn't copy"
				: "Copy for agent";

	return (
		<div className="docs-pact">
			<button
				type="button"
				className="docs-pill"
				title="Page, collapsed sections and agent notes, as Markdown"
				onClick={async () => {
					const ok = await copyMarkdown(md).catch(() => false);
					setCopy(ok ? "done" : "failed");
					clearTimeout(timer.current);
					timer.current = window.setTimeout(() => setCopy("idle"), FLASH_MS);
				}}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
					<path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
				</svg>
				<span aria-live="polite">{label}</span>
			</button>
			<a
				className="docs-pill"
				href={md}
				target="_blank"
				rel="noopener noreferrer"
			>
				.md
			</a>
		</div>
	);
}

/** Opens every `<details>` holding the element a hash names, then scrolls to it. */
function openHashTarget(hash: string) {
	const id = decodeURIComponent(hash.replace(/^#/, ""));
	const target = id ? document.getElementById(id) : null;
	if (!target) return;
	let opened = false;
	for (
		let d = target.closest("details");
		d;
		d = d.parentElement?.closest("details") ?? null
	) {
		if (!d.open) {
			d.open = true;
			opened = true;
		}
	}
	if (opened) target.scrollIntoView();
}

/** The breadcrumb + page-actions chrome around a docs page's MDX body. */
export function DocsView({ children }: { children: ReactNode }) {
	const pathname = usePathname();
	const info = lookup(pathname);

	// Deep links open the collapsed row they point at: on load, on hash/history
	// navigation, and on same-page link clicks (client-side links fire neither event).
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run on every page change
	useEffect(() => {
		const fromLocation = () => openHashTarget(window.location.hash);
		const fromClick = (e: MouseEvent) => {
			const a = (e.target as Element).closest<HTMLAnchorElement>(
				"a[href*='#']",
			);
			if (!a) return;
			const url = new URL(a.href, window.location.href);
			if (url.pathname === window.location.pathname) openHashTarget(url.hash);
		};
		const article = document.getElementById("docs-article");
		fromLocation();
		window.addEventListener("hashchange", fromLocation);
		window.addEventListener("popstate", fromLocation);
		article?.addEventListener("click", fromClick);
		return () => {
			window.removeEventListener("hashchange", fromLocation);
			window.removeEventListener("popstate", fromLocation);
			article?.removeEventListener("click", fromClick);
		};
	}, [pathname]);

	return (
		<>
			<div className="docs-topline">
				{info ? (
					<nav className="docs-crumb" aria-label="Breadcrumb">
						<Link href="/docs">Docs</Link>
						<span className="sep">/</span>
						<span>{info.group}</span>
						<span className="sep">/</span>
						<span aria-current="page">{info.title}</span>
					</nav>
				) : (
					<span />
				)}
				<PageActions pathname={pathname} />
			</div>
			<article className="docs-article" id="docs-article">
				{children}
				{info && (info.prev || info.next) ? (
					<nav className="docs-pn" aria-label="Previous and next">
						{info.prev ? (
							<Link href={info.prev.href} rel="prev">
								<span>← Previous</span>
								<b>{info.prev.title}</b>
							</Link>
						) : (
							<span />
						)}
						{info.next ? (
							<Link href={info.next.href} rel="next">
								<span>Next →</span>
								<b>{info.next.title}</b>
							</Link>
						) : null}
					</nav>
				) : null}
				<a
					className="docs-edit"
					href={`${GITHUB_URL}/blob/main/apps/web/src/app/(www)/${githubSourcePath(pathname)}`}
					target="_blank"
					rel="noopener noreferrer"
				>
					Edit on GitHub
				</a>
			</article>
		</>
	);
}
