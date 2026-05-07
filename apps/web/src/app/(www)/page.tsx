import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "secondlayer · the data plane for Stacks",
	description:
		"Layered, observable, dependable data infrastructure for every team building on Stacks. Foundation Datasets are public goods, free forever. Launching May 27.",
};

export default function WwwLandingPage() {
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
					<div className="index-year">Manifest</div>
					<div className="prose www-manifest">
						<p>
							The chain produces events. Applications need those events{" "}
							<em>shaped, decoded, joined, delivered</em> in ways no single API
							can anticipate. Today, every team building on Stacks rebuilds the
							same indexing infrastructure — running their own nodes, writing
							their own decoders, handling their own reorgs. That work is
							undifferentiated. It should be a utility, and we run it.
						</p>
						<p>
							<strong>Five layers, each independently useful.</strong>{" "}
							<strong>Streams</strong> is the raw event firehose —
							cursor-paginated, idempotent, replayable. <strong>Index</strong>{" "}
							is the decoded transaction-level read API.{" "}
							<Link href="/docs/subgraphs">Subgraphs</Link> let teams that
							outgrow public datasets define their own shape and deploy to a
							dedicated Postgres they can SSH into.{" "}
							<strong>Subscriptions</strong> push the rows that matter to your
							webhook. Pick the layer that matches your problem and ignore the
							rest.
						</p>
						<p>
							On top of those layers we publish five{" "}
							<Link href="/docs/datasets">Foundation Datasets</Link> —{" "}
							<Link href="/docs/datasets/stx-transfers">STX transfers</Link>,{" "}
							<Link href="/docs/datasets/sbtc">sBTC</Link>,{" "}
							<Link href="/docs/datasets/pox-4">PoX-4 stacking</Link>,{" "}
							<Link href="/docs/datasets/bns">BNS</Link>, and{" "}
							<Link href="/docs/datasets/network-health">Network Health</Link>.
							Stable schemas, REST APIs, parquet bulk dumps, public freshness
							reporting. They are{" "}
							<span className="pink">public goods, free forever</span>. We
							monetize hosted infrastructure, not access to chain data.
						</p>
						<p>
							Public APIs work today. Hobby tier and paid plans open{" "}
							<strong>May 27</strong>. Get the launch note —{" "}
							<a href="mailto:hi@secondlayer.tools?subject=Launch%20list">
								hi@secondlayer.tools
							</a>
							.
						</p>
					</div>
				</div>
			</section>
		</div>
	);
}
