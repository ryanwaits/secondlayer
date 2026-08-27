import { CodeBlock } from "@/components/code-block";
import {
	HARNESSES,
	type PromptStep,
	READ_CMD,
	SETUP_STEP,
	TABLE_STEP,
} from "@/lib/home-quickstart";
import Link from "next/link";
import type { ReactNode } from "react";
import { HarnessPicker } from "./harness-picker";

const SKILL_REPO =
	"https://github.com/ryanwaits/secondlayer/tree/main/skills/secondlayer";

/** Docs code block inside a titled window: dots + file name, then shiki. */
function Window({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="home-qs-win">
			<div className="home-qs-bar">
				<span className="home-qs-dots" aria-hidden="true">
					<i />
					<i />
					<i />
				</span>
				{title}
			</div>
			{children}
		</div>
	);
}

function Step({
	title,
	aside,
	children,
}: {
	title: string;
	aside?: string;
	children: ReactNode;
}) {
	return (
		<li className="home-qs-step">
			<div className="home-qs-body">
				<h3>
					{title}
					{aside ? <small>{aside}</small> : null}
				</h3>
				{children}
			</div>
		</li>
	);
}

/** A prompt you say to the harness, followed by what the skill ran. */
function Prompt({ step }: { step: PromptStep }) {
	return (
		<>
			<Window title="claude">
				<CodeBlock code={step.prompt} lang="markdown" />
			</Window>
			<ul className="home-qs-ran">
				{step.ran.map((line) => (
					<li key={line} data-ok={line.startsWith("✓") ? "" : undefined}>
						{line}
					</li>
				))}
			</ul>
		</>
	);
}

export function AgentQuickstart() {
	return (
		<section className="home-qs" aria-labelledby="home-qs-h">
			<div className="home-qs-in">
				<h2 id="home-qs-h">
					From zero to a live table, with your agent driving.
				</h2>
				<p className="home-sub">
					The docs ship as a skill. Install it once and your harness knows every
					command; you describe the table, it does the setup. No account. One
					token from <code>secondlayer init</code>.
				</p>

				<ol className="home-qs-steps">
					<Step title="Install the skill">
						<HarnessPicker
							options={HARNESSES.map(({ key, label, blurb }) => ({
								key,
								label,
								blurb,
							}))}
							panels={HARNESSES.map((h) => (
								<Window key={h.key} title={h.file}>
									<CodeBlock code={h.code} lang={h.lang} />
								</Window>
							))}
						/>
					</Step>

					<Step title="Stand up the instance" aside="ask, don’t configure">
						<p className="home-qs-blurb">
							The skill runs <code>secondlayer setup</code>: compose file,
							secrets, archive bootstrap, then verifies the result against the
							signed snapshot.
						</p>
						<Prompt step={SETUP_STEP} />
					</Step>

					<Step title="Describe the table" aside="it writes the subgraph">
						<p className="home-qs-blurb">
							A subgraph is one TypeScript file: filters, schema, handlers. The
							skill scaffolds it from the contract, deploys, and hands you the
							URL.
						</p>
						<Prompt step={TABLE_STEP} />
					</Step>

					<Step title="Read it" aside="yours, in Postgres, with REST for free">
						<p className="home-qs-blurb">
							Loopback reads need no key. The same rows are in the database you
							operate.
						</p>
						<Window title="terminal">
							<CodeBlock code={READ_CMD} lang="bash" />
						</Window>
					</Step>
				</ol>

				<nav className="home-qs-foot" aria-label="Quickstart links">
					<Link href="/docs/quickstart">Full quickstart</Link>
					<a href={SKILL_REPO}>Skill on GitHub</a>
					<Link href="/docs/mcp">MCP server</Link>
					<Link href="/llms.txt">/llms.txt</Link>
				</nav>
			</div>
		</section>
	);
}
