import { DOCS_PRODUCTS, type ProductKey } from "@/app/(www)/docs/products";
import {
	LayersIcon,
	PulseIcon,
	RowsIcon,
	ShieldCheckIcon,
	TableIcon,
	WavesIcon,
} from "@/components/site/icons";
import Link from "next/link";
import type { ReactNode } from "react";

/** One glyph per product, shared by the stack and the seam. */
export const PRODUCT_GLYPH: Record<ProductKey, () => ReactNode> = {
	archive: LayersIcon,
	streams: WavesIcon,
	index: RowsIcon,
	subgraphs: TableIcon,
	webhooks: PulseIcon,
};

/**
 * The five products as one stack, top to bottom: Webhooks (closest to your
 * app) down to Archive (closest to the chain), with Verify under all. Each row
 * says what you get and what you write there. Intro page only.
 */
export function Stack() {
	return (
		<div className="docs-stack">
			<div className="docs-stack-head" aria-hidden="true">
				<span />
				<span>Layer</span>
				<span>You get</span>
				<span>You write</span>
			</div>
			<div className="docs-stack-rows">
				{[...DOCS_PRODUCTS].reverse().map((p) => {
					const Glyph = PRODUCT_GLYPH[p.key];
					return (
						<Link
							key={p.key}
							className="docs-stack-row"
							href={p.href}
							data-href={p.href}
						>
							<Glyph />
							<span className="docs-stack-name">{p.title}</span>
							<span>{p.stack.get}</span>
							<span className="docs-stack-write">{p.stack.write}</span>
						</Link>
					);
				})}
				<div className="docs-stack-row docs-stack-base">
					<ShieldCheckIcon />
					<span>
						<Link href="/docs/verification">Verify</Link> runs under every
						layer: a block, a transaction, a bundle or a subgraph row, checked
						on your machine.
					</span>
				</div>
			</div>
		</div>
	);
}
