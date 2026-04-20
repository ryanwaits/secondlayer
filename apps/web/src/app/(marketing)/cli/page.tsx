import { CodeBlock } from "@/components/code-block";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";

const toc: TocItem[] = [
	{ label: "Install", href: "#install" },
	{ label: "Auth", href: "#auth" },
	{ label: "Subgraphs", href: "#subgraphs" },
	{ label: "Workflows", href: "#workflows" },
];

export default function CliPage() {
	return (
		<div className="article-layout">
			<Sidebar title="CLI" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">CLI</h1>
				</header>

				<div className="prose">
					<p>
						One binary, both primitives. Deploy a subgraph or a workflow, query
						data, manage runs — same auth, same patterns as the SDK and MCP
						server. Install globally with{" "}
						<code>bun add -g @secondlayer/cli</code>.
					</p>
				</div>

				<SectionHeading id="install">Install</SectionHeading>

				<CodeBlock
					code={`bun add -g @secondlayer/cli

sl --version
sl login`}
					lang="bash"
				/>

				<SectionHeading id="auth">Auth</SectionHeading>

				<CodeBlock
					code={`# Login — magic-link email with 6-digit code. Session cached at ~/.secondlayer/session.json.
sl login

sl whoami
sl logout`}
					lang="bash"
				/>

				<SectionHeading id="subgraphs">Subgraphs</SectionHeading>

				<CodeBlock
					code={`sl subgraphs deploy subgraphs/token-transfers.ts
sl subgraphs dev subgraphs/token-transfers.ts       # watch + hot-redeploy
sl subgraphs status token-transfers
sl subgraphs query token-transfers transfers --sort _block_height --order desc
sl subgraphs query token-transfers transfers --filter sender=SP1234... --count
sl subgraphs reindex token-transfers
sl subgraphs scaffold SP1234...::my-contract --output subgraphs/my-contract.ts
sl subgraphs delete token-transfers`}
					lang="bash"
				/>

				<SectionHeading id="workflows">Workflows</SectionHeading>

				<CodeBlock
					code={`sl workflows deploy workflows/whale-alert.ts
sl workflows dev workflows/whale-alert.ts           # watch + hot-redeploy
sl workflows ls
sl workflows get whale-alert
sl workflows trigger whale-alert --input '{"threshold": 100000}'
sl workflows runs whale-alert --status failed
sl workflows pause whale-alert
sl workflows resume whale-alert
sl workflows delete whale-alert`}
					lang="bash"
				/>
			</main>
		</div>
	);
}
