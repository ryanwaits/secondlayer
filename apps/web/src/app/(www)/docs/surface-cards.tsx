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

/** The four product surfaces, mirroring the "Core surfaces" nav + their REST
 *  entrypoints. Streams spans the full row. */
const SURFACES: Surface[] = [
	{
		n: "01",
		name: "Index",
		href: "/docs/index",
		desc: "Query decoded blocks, transactions, and events through one endpoint.",
		verb: "GET",
		ep: "/v1/index/events",
	},
	{
		n: "02",
		name: "Subgraphs",
		href: "/docs/subgraphs",
		desc: "Define app-specific materialized tables from contract events.",
		verb: "GET",
		ep: "/v1/subgraphs",
	},
	{
		n: "03",
		name: "Subscriptions",
		href: "/docs/subscriptions",
		desc: "Push matched rows to your webhook as signed POSTs.",
		verb: "POST",
		ep: "→ your webhook",
	},
	{
		n: "04",
		name: "Streams",
		href: "/docs/streams",
		desc: "The raw chain-event firehose — cursor-paginated and replayable.",
		verb: "GET",
		ep: "/v1/streams",
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
