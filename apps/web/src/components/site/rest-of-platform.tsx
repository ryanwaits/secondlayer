import { PRODUCTS } from "@/lib/site";
import Link from "next/link";
import type { ReactNode } from "react";

/** Links to every other product. Reads PRODUCTS, so a new product shows up here. */
export function RestOfPlatform({
	exclude,
	blurbs,
}: {
	/** Hrefs to leave out (the current page). */
	exclude?: readonly string[];
	/** Optional per-href heading + body overriding the product's one-liner. */
	blurbs?: Partial<Record<string, { title: string; body: ReactNode }>>;
}) {
	const items = PRODUCTS.filter((p) => !exclude?.includes(p.href));
	return (
		<div className="which">
			{items.map((p) => {
				const blurb = blurbs?.[p.href];
				return (
					<Link href={p.href} key={p.href}>
						<h3>{blurb?.title ?? p.line}</h3>
						{blurb ? <p>{blurb.body}</p> : null}
						<span className="go">Learn more →</span>
					</Link>
				);
			})}
		</div>
	);
}
