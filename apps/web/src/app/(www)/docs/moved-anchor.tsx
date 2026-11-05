"use client";

import { notify } from "@/components/toast/notify";
import type { DocsSearchDoc } from "@/lib/docs-bm25";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * A link to `/docs/x#section` after that section moved to another page lands
 * on the right page's top with nothing to say why. When the anchor isn't on
 * this page but a section with that anchor lives elsewhere in the docs, say
 * where it went. No redirect map: the search index already knows every anchor.
 */
export function DocsMovedAnchor() {
	const pathname = usePathname();
	const router = useRouter();

	useEffect(() => {
		let live = true;
		const check = () => {
			const anchor = decodeURIComponent(window.location.hash.slice(1));
			if (!anchor || document.getElementById(anchor)) return;
			fetch("/docs/search-index.json")
				.then((res) => (res.ok ? (res.json() as Promise<DocsSearchDoc[]>) : []))
				.then((docs) => {
					if (!live || document.getElementById(anchor)) return;
					const moved = docs.find(
						(d) =>
							d.kind === "section" &&
							d.href.endsWith(`#${anchor}`) &&
							!d.href.startsWith(`${pathname}#`),
					);
					if (!moved) return;
					notify.done("That section moved", {
						desc: `${moved.page} › ${moved.label}`,
						duration: 10_000,
						action: { label: "Open", run: () => router.push(moved.href) },
					});
				})
				.catch(() => {});
		};
		check();
		window.addEventListener("hashchange", check);
		return () => {
			live = false;
			window.removeEventListener("hashchange", check);
		};
	}, [pathname, router]);

	return null;
}
