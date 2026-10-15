import {
	DOCS_PRODUCTS,
	type ProductKey,
	START_PAGES,
	type StartKey,
} from "@/app/(www)/docs/products";

function pairFor(page: ProductKey | StartKey) {
	const start = START_PAGES.find((p) => p.key === page);
	if (start) {
		if (!start.yields) throw new Error(`Yields: "${page}" has no yields`);
		return {
			get: start.yields.get,
			writeLabel: start.yields.writeLabel,
			write: start.yields.write,
		};
	}
	const product = DOCS_PRODUCTS.find((p) => p.key === page);
	if (!product) throw new Error(`Yields: unknown page "${page}"`);
	return { get: product.get, writeLabel: "You write", write: product.write };
}

/**
 * "You get / You write" for a product or start page: what it hands you, and the
 * one thing you author or set there. Opens the page.
 */
export function Yields({ page }: { page: ProductKey | StartKey }) {
	const { get, writeLabel, write } = pairFor(page);
	return (
		<div className="docs-yields">
			<div>
				<span className="docs-eyebrow">You get</span>
				<span>{get}</span>
			</div>
			<div>
				<span className="docs-eyebrow">{writeLabel}</span>
				<span>{write}</span>
			</div>
		</div>
	);
}
