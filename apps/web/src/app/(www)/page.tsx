import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "secondlayer · the data plane for Stacks",
	description:
		"Streams, Subgraphs, Subscriptions, Foundation Datasets. Public APIs free forever, hosted infrastructure on top. Launching May 27.",
};

const products = [
	{ name: "Streams", href: "/streams" },
	{ name: "Subgraphs", href: "/subgraphs" },
	{ name: "Subscriptions", href: "/subscriptions" },
	{ name: "Datasets", href: "/datasets" },
	{ name: "Tools", href: "/tools" },
];

function IndexRow({ item }: { item: { name: string; href: string } }) {
	return (
		<li className="index-item">
			<Link href={item.href} className="index-link">
				<span className="index-link-label">{item.name}</span>
			</Link>
		</li>
	);
}

export default function Home() {
	return (
		<div className="homepage">
			<header className="page-header">
				<h1 className="page-title">secondlayer</h1>
				<p className="page-sub">the data plane for Stacks · launching May 27</p>
			</header>

			<div className="prose www-manifest">
				<p>
					Every team building on Stacks rebuilds the same indexing
					infrastructure — own nodes, own decoders, own reorg handling, own
					schemas. That work is undifferentiated; it should be a utility. We run
					that utility.
				</p>
				<p>
					Streams for raw events, Subgraphs for typed indexers, Subscriptions
					for push delivery, and five{" "}
					<Link href="/datasets">Foundation Datasets</Link> as{" "}
					<span className="pink">public goods, free forever</span>. Hosted
					infrastructure on top.
				</p>
			</div>

			<section
				className="index-group"
				style={{ marginTop: "var(--spacing-xl)" }}
			>
				<div className="index-year-group">
					<div className="index-year">Products</div>
					<ul className="index-list">
						{products.map((p) => (
							<IndexRow key={p.href} item={p} />
						))}
					</ul>
				</div>
			</section>
		</div>
	);
}
