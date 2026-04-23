import { CodeBlock } from "@/components/code-block";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";

const toc: TocItem[] = [
	{ label: "Tiers", href: "#tiers" },
	{ label: "Metering", href: "#metering" },
	{ label: "Self-host", href: "#self-host" },
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
						Hosted subgraphs + dedicated Postgres. Free Hobby tier,
						Supabase-style metered paid plans. Self-host is MIT-licensed.
					</p>
				</div>

				<SectionHeading id="tiers">Tiers</SectionHeading>

				<div className="prose">
					<table>
						<thead>
							<tr>
								<th>Plan</th>
								<th>Compute</th>
								<th>Storage</th>
								<th>Monthly base</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td>Hobby</td>
								<td>Auto-pause after 7d idle</td>
								<td>5 GB</td>
								<td>Free</td>
							</tr>
							<tr>
								<td>Launch</td>
								<td>500 compute-hours</td>
								<td>50 GB</td>
								<td>$149</td>
							</tr>
							<tr>
								<td>Grow</td>
								<td>1,000 compute-hours</td>
								<td>200 GB</td>
								<td>$349</td>
							</tr>
							<tr>
								<td>Scale</td>
								<td>2,500 compute-hours</td>
								<td>1 TB</td>
								<td>$799</td>
							</tr>
							<tr>
								<td>Enterprise</td>
								<td>Unlimited</td>
								<td>Unlimited</td>
								<td>Custom</td>
							</tr>
						</tbody>
					</table>
				</div>

				<SectionHeading id="metering">Metering</SectionHeading>

				<div className="prose">
					<p>
						Paid tiers include a base compute + storage allowance. Overage bills
						per Stripe meter: compute-hours past allowance, and{" "}
						<code>$2/GB</code> for storage over allowance. Hobby has a hard 5 GB
						cap (no overage billing) and auto-pauses idle projects after 7 days.
					</p>
				</div>

				<SectionHeading id="self-host">Self-host</SectionHeading>

				<div className="prose">
					<p>
						The whole stack is MIT-licensed. Run indexer + API + processor on
						your own hardware, free forever.
					</p>
				</div>

				<CodeBlock
					lang="bash"
					code={`git clone https://github.com/secondlayer/secondlayer
cd secondlayer/docker/oss
docker compose up`}
				/>

				<div className="prose">
					<p>
						See{" "}
						<a href="https://github.com/secondlayer/secondlayer/blob/main/docker/oss/README.md">
							<code>docker/oss/README.md</code>
						</a>{" "}
						for the full setup.
					</p>
				</div>
			</main>
		</div>
	);
}
