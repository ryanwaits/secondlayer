import { CodeBlock } from "@/components/code-block";
import { MarketingPageHeader } from "@/components/marketing-page-header";
import { SectionHeading } from "@/components/section-heading";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "CLI | secondlayer",
	description:
		"One binary for everything — login, deploy subgraphs, query tables, manage subscriptions, and tail Streams.",
};

export default function CliPage() {
	return (
		<main className="explore-wrap">
			<MarketingPageHeader crumb="Developers" here="CLI" title="CLI" />
			<div className="mk-body">

				<div className="prose">
					<p>
						One binary for everything you'd otherwise click through dashboards
						for. Login, deploy, query, manage subscriptions, tail Streams,
						provision dedicated instances. Same auth as every other surface —
						sign in once and the session is inherited.
					</p>
				</div>

				<SectionHeading id="install">Install</SectionHeading>

				<CodeBlock lang="bash" code={"bun add -g @secondlayer/cli"} />

				<SectionHeading id="workflow">Workflow</SectionHeading>

				<CodeBlock
					lang="bash"
					code={`sl login                                  # magic-link email
sl subgraphs create my-watcher --template sip-010-balances
sl subgraphs deploy my-watcher.ts         # prompts login if no session
sl subgraphs query my-watcher transfers --filter recipient=SP1...
sl streams events --types print --contract-id SP2...BNS-V2
sl subscriptions create my-watcher --runtime node`}
				/>
			</div>
		</main>
	);
}
