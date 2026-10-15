import { BLOCK_CHECK, DOCS_PRODUCTS } from "@/app/(www)/docs/products";
import { PRODUCT_GLYPH } from "@/components/docs/stack";
import { ShieldCheckIcon } from "@/components/site/icons";
import Link from "next/link";

/**
 * Verify's check map, in the intro stack's order and glyphs: one row per
 * layer (Webhooks down to Archive), then the check under all of them.
 */
export function Checks() {
	return (
		<div className="docs-checks">
			<div className="docs-checks-head" aria-hidden="true">
				<span />
				<span>Layer</span>
				<span>You can prove</span>
				<span>Run</span>
				<span>You still trust</span>
			</div>
			{[...DOCS_PRODUCTS].reverse().map((p) => {
				const Glyph = PRODUCT_GLYPH[p.key];
				return (
					<div key={p.key} className="docs-check-row" data-href={p.href}>
						<Glyph />
						<Link href={p.href} className="docs-check-name">
							{p.title}
						</Link>
						<span>{p.check.prove}</span>
						<code>{p.check.run}</code>
						<span className="docs-check-trust">{p.check.trust}</span>
					</div>
				);
			})}
			<div className="docs-check-row docs-check-base">
				<ShieldCheckIcon />
				<span className="docs-check-name">{BLOCK_CHECK.title}</span>
				<span>{BLOCK_CHECK.prove}</span>
				<code>{BLOCK_CHECK.run}</code>
				<span className="docs-check-trust">{BLOCK_CHECK.trust}</span>
			</div>
		</div>
	);
}
