import Link from "next/link";

interface Surface {
	n: string;
	name: string;
	href: string;
	desc: string;
	/** Language tag for the entry-point call below it. */
	lang: string;
	/** The call you actually write — the SDK entry point, not an endpoint. */
	call: string;
	wide?: boolean;
}

/** The four surfaces of a self-hosted instance.
 *  Each card leads with the call you write, not the endpoint you hit.
 *  Subscriptions spans the full row. */
const SURFACES: Surface[] = [
	{
		n: "01",
		name: "Index",
		href: "/docs/index",
		desc: "Decoded blocks, transactions, and events — swept into your own tables, backfilled from genesis, reorgs rolled back for you.",
		lang: "ts",
		call: "sl.index.events.consume()",
	},
	{
		n: "02",
		name: "Subgraphs",
		href: "/docs/subgraphs",
		desc: "Your schema on your instance — one TypeScript file, tables in your Postgres, served from your API. The loop above, run for you.",
		lang: "ts",
		call: "defineSubgraph({ … })",
	},
	{
		n: "03",
		name: "Streams",
		href: "/docs/streams",
		desc: "Raw signed event firehose + dumps — for building your own decoder from the inputs up.",
		lang: "ts",
		call: "sl.streams.events.consume()",
	},
	{
		n: "04",
		name: "Subscriptions",
		href: "/docs/subscriptions",
		desc: "The push channel — matched rows or chain events to your webhook, signed. No polling loop to babysit.",
		lang: "ts",
		call: "sl.subscriptions.create()",
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
						<span className="verb">{s.lang}</span> {s.call}
					</span>
				</Link>
			))}
		</div>
	);
}
