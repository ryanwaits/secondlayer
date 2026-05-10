import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "secondlayer · the agent-native data plane for Stacks",
	description:
		"The agent-native data plane for Stacks. Pull with Streams, index with Subgraphs, push with Subscriptions, query five Foundation Datasets directly. Public goods, free forever.",
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
				<p className="page-sub">
					the agent-native data plane for Stacks · launching May 27
				</p>
			</header>

			<div className="prose www-manifest">
				<p>
					Secondlayer is the agent-native data plane for Stacks.{" "}
					<em>
						The chain produces events; apps and agents need them in any shape.
					</em>
				</p>
				<p>
					Pull them with Streams, index them with Subgraphs, push them with
					Subscriptions, or query five{" "}
					<Link href="/datasets">
						<mark>Foundation Datasets</mark>
					</Link>{" "}
					directly. Public goods, free forever. Hosted infrastructure on top.
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
