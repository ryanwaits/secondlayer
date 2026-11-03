import { docsNavPages } from "@/app/(www)/docs/nav";
import { ROUTES } from "@/app/sitemap";
import { NotFoundView } from "@/components/not-found/not-found-view";
import type { Route } from "@/lib/not-found-match";
import { PRODUCTS } from "@/lib/site";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Not found · secondlayer",
	robots: { index: false, follow: false },
};

const SITE_TITLES: Record<string, string> = {
	"/": "Home",
	...Object.fromEntries(PRODUCTS.map((p) => [p.href, p.noun])),
};

const titleFor = (href: string) =>
	SITE_TITLES[href] ??
	(href.slice(1).charAt(0).toUpperCase() + href.slice(2) || "Home");

/**
 * Every unmatched URL lands here. The server lists the pages a visitor could
 * have meant; the view reads the path in the browser and offers the closest.
 */
export default function NotFound() {
	const docs: Route[] = [
		...new Map(
			docsNavPages().map((p) => {
				const href = p.href.split("#")[0] ?? p.href;
				return [href, { href, title: p.title }];
			}),
		).values(),
	];
	const site: Route[] = [
		...ROUTES.map((href) => ({ href, title: titleFor(href) })),
		{ href: "/docs", title: "Docs" },
	];
	return <NotFoundView routes={{ site, docs }} />;
}
