import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "secondlayer · the data plane for Stacks",
	description:
		"Streams, Subgraphs, Subscriptions, Foundation Datasets. Public APIs free forever, hosted infrastructure on top. Launching May 27.",
};

const products = [
	{ name: "Streams", href: "/streams", desc: "raw event firehose" },
	{ name: "Subgraphs", href: "/subgraphs", desc: "typed indexers" },
	{ name: "Subscriptions", href: "/subscriptions", desc: "push semantics" },
	{ name: "Datasets", href: "/datasets", desc: "five public goods" },
	{ name: "Tools", href: "/tools", desc: "SDK · CLI · MCP · Stacks" },
];

const datasets = [
	{ name: "STX transfers", href: "/datasets/stx-transfers" },
	{ name: "sBTC", href: "/datasets/sbtc" },
	{ name: "PoX-4 stacking", href: "/datasets/pox-4" },
	{ name: "BNS", href: "/datasets/bns" },
	{ name: "Network health", href: "/datasets/network-health" },
];

function IndexRow({
	item,
}: {
	item: { name: string; href: string; desc?: string };
}) {
	return (
		<li className="index-item">
			<Link href={item.href} className="index-link">
				<span className="index-link-label">{item.name}</span>
				{item.desc ? <span className="index-date">{item.desc}</span> : null}
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

				<div className="index-year-group">
					<div className="index-year">Datasets</div>
					<ul className="index-list">
						{datasets.map((d) => (
							<IndexRow key={d.href} item={d} />
						))}
					</ul>
				</div>

				<div className="index-year-group">
					<div className="index-year">More</div>
					<ul className="index-list">
						<IndexRow item={{ name: "Pricing", href: "/pricing" }} />
						<IndexRow item={{ name: "Status", href: "/status" }} />
						<IndexRow
							item={{
								name: "Get the launch note",
								href: "mailto:hi@secondlayer.tools?subject=Launch%20list",
							}}
						/>
					</ul>
				</div>
			</section>
		</div>
	);
}
