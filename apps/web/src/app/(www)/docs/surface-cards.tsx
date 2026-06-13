import Link from "next/link";

interface Surface {
	n: string;
	name: string;
	href: string;
	desc: string;
	verb: string;
	ep: string;
	wide?: boolean;
}

/** Three products, then their features — mirrors STRATEGY.md's taxonomy.
 *  Subscriptions spans the full row. */
const SURFACES: Surface[] = [
	{
		n: "01",
		name: "Index",
		href: "/docs/index",
		desc: "Decoded blocks, transactions, and events — read them keyless, or build your index on them.",
		verb: "GET",
		ep: "/v1/index/events",
	},
	{
		n: "02",
		name: "Subgraphs",
		href: "/docs/subgraphs",
		desc: "Your schema on our indexer — one TypeScript file, hosted tables, public API.",
		verb: "GET",
		ep: "/v1/subgraphs",
	},
	{
		n: "03",
		name: "Streams",
		href: "/docs/streams",
		desc: "Raw signed event firehose + dumps — for building your own indexer.",
		verb: "GET",
		ep: "/v1/streams",
	},
	{
		n: "04",
		name: "Subscriptions",
		href: "/docs/subscriptions",
		desc: "The push channel — matched rows or chain events to your webhook, signed.",
		verb: "POST",
		ep: "→ your webhook",
		wide: true,
	},
];

/** "Pick your surface" card grid for the docs intro. Replaces the prior
 *  dashed bullet list; the surrounding headers are unchanged. */
export function SurfaceCards() {
	return (
		<div className="docs-surfaces">
			{SURFACES.map((s) => (
				<Link
					key={s.href}
					href={s.href}
					className={`docs-surface${s.wide ? " wide" : ""}`}
				>
					<span className="docs-surface-num">{s.n}</span>
					<span className="docs-surface-name">
						{s.name}
						<span className="docs-surface-arrow" aria-hidden="true">
							→
						</span>
					</span>
					<span className="docs-surface-desc">{s.desc}</span>
					<span className="docs-surface-ep">
						<span className="verb">{s.verb}</span> {s.ep}
					</span>
				</Link>
			))}
		</div>
	);
}
