import { CodeBlock } from "@/components/code-block";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import { PLANS, PLAN_IDS } from "@secondlayer/shared/pricing";

const toc: TocItem[] = [
	{ label: "Tiers", href: "#tiers" },
	{ label: "Metering", href: "#metering" },
	{ label: "Self-host", href: "#self-host" },
];

function formatPrice(cents: number | null): string {
	if (cents === null) return "Custom";
	if (cents === 0) return "Free";
	return `$${cents / 100}`;
}

function formatMonthly(cents: number | null): string {
	if (cents === null || cents === 0) return formatPrice(cents);
	return `${formatPrice(cents)}/mo`;
}

function formatStorage(mb: number): string {
	if (mb < 0) return "Unlimited";
	if (mb >= 1024) return `${mb / 1024} GB`;
	return `${mb} MB`;
}

function formatCompute(plan: (typeof PLANS)[keyof typeof PLANS]): string {
	if (plan.id === "enterprise") return "Custom";
	return `${plan.totalCpus} vCPU · ${plan.totalMemoryMb / 1024} GB RAM`;
}

function formatAnnual(cents: number | null): string {
	if (cents === null) return "—";
	return `$${cents / 100}/yr`;
}

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
						Hosted subgraphs + dedicated Postgres. Free Hobby tier, two paid
						tiers, custom Enterprise. Annual paid plans include 2 months free.
						Pay for compute; subgraphs and subscriptions are unlimited on every
						paid tier. Self-host is MIT-licensed.
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
								<th>Monthly</th>
								<th>Annual</th>
							</tr>
						</thead>
						<tbody>
							{PLAN_IDS.map((id) => {
								const p = PLANS[id];
								return (
									<tr key={id}>
										<td>{p.displayName}</td>
										<td>{formatCompute(p)}</td>
										<td>{formatStorage(p.storageLimitMb)}</td>
										<td>{formatMonthly(p.monthlyPriceCents)}</td>
										<td>{formatAnnual(p.annualPriceCents)}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>

				<SectionHeading id="metering">Metering</SectionHeading>

				<div className="prose">
					<p>
						Compute is hard-capped per tier (Docker enforces vCPU + memory) —
						upgrade for more, no surprise compute overage. Storage past the plan
						limit bills at <code>$2/GB-month</code> via Stripe meter. Hobby has
						a hard 10 GB cap with no overage billing and auto-pauses idle
						projects after 7 days.
					</p>
					<p>
						AI sessions on the dashboard bill metered against the{" "}
						<code>ai_evals</code> meter — you only pay for what your sessions
						use. Spend caps + alert thresholds are configurable per account.
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
