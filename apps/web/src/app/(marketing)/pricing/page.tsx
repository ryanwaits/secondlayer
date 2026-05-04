import { CodeBlock } from "@/components/code-block";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";

const toc: TocItem[] = [
	{ label: "Tiers", href: "#tiers" },
	{ label: "Metering", href: "#metering" },
	{ label: "Self-host", href: "#self-host" },
];

const tiers = [
	{
		name: "Free",
		price: "$0",
		streamsWindow: "7 days",
		indexRows: "100K / mo",
		subgraphs: "1",
		subscriptions: "1 SSE",
		mcp: "self-host",
		sla: "best effort",
	},
	{
		name: "Build",
		price: "$99/mo",
		streamsWindow: "30 days",
		indexRows: "2M / mo",
		subgraphs: "5",
		subscriptions: "10, 1M events / mo",
		mcp: "self-host",
		sla: "99.5%",
	},
	{
		name: "Scale",
		price: "$499/mo",
		streamsWindow: "90 days",
		indexRows: "25M / mo",
		subgraphs: "25",
		subscriptions: "100, 10M events / mo",
		mcp: "hosted",
		sla: "99.9%",
	},
	{
		name: "Enterprise",
		price: "Custom",
		streamsWindow: "Full archive",
		indexRows: "Custom",
		subgraphs: "Custom",
		subscriptions: "Custom",
		mcp: "hosted",
		sla: "Custom",
	},
];

export default function PricingPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Pricing" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">Pricing</h1>
				</header>

				<div className="prose">
					<p>
						Second Layer prices the data plane in layers. Stacks Streams is the
						raw event feed. Stacks Index is decoded event access. Stacks
						Subgraphs, Subscriptions, and MCP Server sit above those reads.
					</p>
				</div>

				<SectionHeading id="tiers">Tiers</SectionHeading>

				<div className="prose">
					<table>
						<thead>
							<tr>
								<th>Plan</th>
								<th>Price</th>
								<th>Streams window</th>
								<th>Index rows</th>
								<th>Subgraphs</th>
								<th>Subscriptions</th>
								<th>MCP Server</th>
								<th>SLA</th>
							</tr>
						</thead>
						<tbody>
							{tiers.map((tier) => {
								return (
									<tr key={tier.name}>
										<td>{tier.name}</td>
										<td>{tier.price}</td>
										<td>{tier.streamsWindow}</td>
										<td>{tier.indexRows}</td>
										<td>{tier.subgraphs}</td>
										<td>{tier.subscriptions}</td>
										<td>{tier.mcp}</td>
										<td>{tier.sla}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>

				<SectionHeading id="metering">Metering</SectionHeading>

				<div className="prose">
					<p>
						Stacks Streams meters events returned. Stacks Index meters decoded
						events returned. Subscriptions meter delivered events. Stacks
						Subgraphs meter storage above the tier allowance.
					</p>
					<p>
						Overages are $4 per additional 100K Stacks Index rows, $1 per
						additional 100K subscription events, and $0.50/GB-month for
						Subgraphs storage above the tier limit.
					</p>
				</div>

				<SectionHeading id="self-host">Self-host</SectionHeading>

				<div className="prose">
					<p>
						The open-source packages can run on your own hardware. Hosted
						operation, support, retained Streams windows, and hosted MCP Server
						come from the paid tiers.
					</p>
				</div>

				<CodeBlock
					lang="bash"
					code={`git clone https://github.com/ryanwaits/secondlayer
cd secondlayer/docker/oss
docker compose up`}
				/>

				<div className="prose">
					<p>
						See{" "}
						<a href="https://github.com/ryanwaits/secondlayer/blob/main/docker/oss/README.md">
							<code>docker/oss/README.md</code>
						</a>{" "}
						for the full setup.
					</p>
				</div>
			</main>
		</div>
	);
}
