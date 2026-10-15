import {
	type DocsProduct,
	type ProductKey,
	SEAM_CELLS,
	START_PAGES,
	type StartCell,
	type StartKey,
	neighbours,
} from "@/app/(www)/docs/products";
import Link from "next/link";

function Cell({
	label,
	from,
	to,
}: { label: string; from: ProductKey; to: DocsProduct }) {
	const text = SEAM_CELLS[`${from}>${to.key}`];
	return (
		<Link className="docs-seam-cell" href={to.href}>
			<span className="docs-eyebrow">{label}</span>
			<span className="docs-seam-to">{to.title}</span>
			<span className="docs-seam-why">{text?.why}</span>
			<span className="docs-seam-tease">{text?.tease}</span>
		</Link>
	);
}

function StartLink({ cell }: { cell: StartCell }) {
	return (
		<Link className="docs-seam-cell" href={cell.href}>
			<span className="docs-eyebrow">{cell.label}</span>
			<span className="docs-seam-to">{cell.title}</span>
			<span className="docs-seam-why">{cell.why}</span>
			<span className="docs-seam-tease">{cell.tease}</span>
		</Link>
	);
}

/**
 * The foot of a product page: one cell toward the chain, one toward your app,
 * each with a line of that layer's code. The ends of the stack say where it
 * stops. Start pages show their two next pages instead. Reference sections start after it (`data-outline-reference`).
 */
export function Seam({ page }: { page: ProductKey | StartKey }) {
	const start = START_PAGES.find((p) => p.key === page);
	if (start) {
		return (
			<nav className="docs-seam" aria-label="Next pages" data-outline-reference>
				{start.seam.map((cell) => (
					<StartLink key={cell.href} cell={cell} />
				))}
			</nav>
		);
	}
	const productKey = page as ProductKey;
	const { down, up } = neighbours(productKey);
	return (
		<nav
			className="docs-seam"
			aria-label="Neighbouring products"
			data-outline-reference
		>
			{down ? (
				<Cell label="↓ One layer down" from={productKey} to={down} />
			) : (
				<div className="docs-seam-cell docs-seam-edge">
					<span className="docs-eyebrow">↓ Bottom layer</span>
					<span className="docs-seam-why">
						Below this is the chain itself:{" "}
						<Link href="/docs/verification">Verify</Link> a block against
						Bitcoin.
					</span>
				</div>
			)}
			{up ? (
				<Cell label="↑ One layer up" from={productKey} to={up} />
			) : (
				<div className="docs-seam-cell docs-seam-edge">
					<span className="docs-eyebrow">↑ Top layer</span>
					<span className="docs-seam-why">
						Above this is your app:{" "}
						<Link href="/docs/deploy">Deploy your app</Link>.
					</span>
				</div>
			)}
		</nav>
	);
}
