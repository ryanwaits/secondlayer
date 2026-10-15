import { DOCS_PRODUCTS, type ProductKey } from "@/app/(www)/docs/products";

/**
 * "You get / You write" for a product page: what the layer hands you, and the
 * one thing you author there. Opens every product page.
 */
export function Yields({ page }: { page: ProductKey }) {
	const product = DOCS_PRODUCTS.find((p) => p.key === page);
	if (!product) throw new Error(`Yields: unknown product "${page}"`);
	return (
		<div className="docs-yields">
			<div>
				<span className="docs-eyebrow">You get</span>
				<span>{product.get}</span>
			</div>
			<div>
				<span className="docs-eyebrow">You write</span>
				<span>{product.write}</span>
			</div>
		</div>
	);
}
