import { CodeBlock } from "@/components/code-block";
import { AgentPromptBlock } from "@/components/console/agent-prompt";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import { getAgentPrompt } from "@/lib/agent-prompts";

const toc: TocItem[] = [
	{ label: "Install", href: "#install" },
	{ label: "Auth", href: "#auth" },
	{ label: "Project", href: "#project" },
	{ label: "Instance", href: "#instance" },
	{ label: "Subgraphs", href: "#subgraphs" },
	{ label: "Subscriptions", href: "#subscriptions" },
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
						One binary. Provision a dedicated instance, deploy subgraphs, query
						data — same auth and patterns as the SDK and MCP server. Install
						globally with <code>bun add -g @secondlayer/cli</code>.
					</p>
				</div>

				<AgentPromptBlock
					title="Operate through sl with your agent."
					code={getAgentPrompt("cli-operate")}
					collapsible
				/>

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

				<SectionHeading id="project">Project</SectionHeading>

				<CodeBlock
					code={`# Projects map 1:1 to dedicated instances. Binding a project to a directory
# is per-directory (like Supabase) — stored at ./.secondlayer/project.
sl project create my-app
sl project use my-app
sl project current
sl project list`}
					lang="bash"
				/>

				<SectionHeading id="instance">Instance</SectionHeading>

				<CodeBlock
					code={`# Provision a dedicated Postgres + API + subgraph processor for the active project.
sl instance create --plan launch     # or scale

sl instance info
sl instance resize --plan scale
sl instance suspend
sl instance resume
sl instance keys rotate --service    # bump JWT gen + mint new key
sl instance delete

# Direct DATABASE_URL via SSH tunnel through the bastion:
sl instance db add-key ~/.ssh/id_ed25519.pub
sl instance db                       # prints ssh -L command + DATABASE_URL`}
					lang="bash"
				/>

				<SectionHeading id="subgraphs">Subgraphs</SectionHeading>

				<CodeBlock
					code={`sl subgraphs scaffold SP1234ABCD.token-transfers --output subgraphs/token-transfers.ts  # writes package.json + runs bun install
sl subgraphs deploy subgraphs/token-transfers.ts --start-block <recent-block>
sl subgraphs dev subgraphs/token-transfers.ts       # watch + hot-redeploy
sl subgraphs list
sl subgraphs status token-transfers
sl subgraphs query token-transfers transfers --sort _block_height --order desc
sl subgraphs query token-transfers transfers --filter sender=SP1234... --count
sl subgraphs reindex token-transfers
sl subgraphs delete token-transfers`}
					lang="bash"
				/>

				<SectionHeading id="subscriptions">Subscriptions</SectionHeading>

				<p className="prose">
					Scaffold a receiver project for your runtime. The CLI drops a ready-
					to-run template into <code>./&lt;name&gt;/</code>, provisions the
					subscription via the SDK, and writes the one-time signing secret into{" "}
					<code>.env</code>. Manage existing subscriptions with{" "}
					<code>sl subscriptions</code>: update filters, pause, resume, rotate
					secrets, inspect deliveries, replay ranges, run doctor, and generate
					signed test fixtures.
				</p>

				<CodeBlock
					code={`# Pick a runtime — scaffolds package.json, src/, README, tsconfig.
sl create subscription whale-alerts --runtime inngest
sl create subscription whale-alerts --runtime trigger --auth-token tr_secret_...
sl create subscription whale-alerts --runtime cloudflare --auth-token <cf-token>
sl create subscription whale-alerts --runtime node

# Flags (all optional; prompts if omitted):
#   --subgraph <name>    --table <name>    --url <https://...>
#   --auth-token <token> --service-key <key> --base-url <url> --skip-api

sl subscriptions list
sl subscriptions update whale-alerts --auth-token <new-token>
sl subscriptions doctor whale-alerts
sl subscriptions test whale-alerts --signing-secret "$SIGNING_SECRET"
sl subscriptions replay whale-alerts --from-block 123000 --to-block 124000`}
					lang="bash"
				/>
			</main>
		</div>
	);
}
