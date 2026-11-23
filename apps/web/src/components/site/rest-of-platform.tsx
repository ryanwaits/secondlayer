import { PRODUCTS } from "@/lib/site";
import Link from "next/link";
import type { ReactNode } from "react";

export function RestOfPlatform({
	exclude,
	blurbs,
}: {
	exclude?: readonly string[];
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
						<span className="go">{p.noun} →</span>
					</Link>
				);
			})}
		</div>
	);
}
