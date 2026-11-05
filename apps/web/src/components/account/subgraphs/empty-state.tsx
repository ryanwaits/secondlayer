import { StatusSentence } from "@/components/dashboard/shell/status-sentence";
import { getAgentPrompt } from "@/lib/agent-prompts";
import { CopyForAgent, EmptyStart, type Guide } from "../empty-start";
import { CliLine } from "../webhooks/shared";

const SUBGRAPH_GUIDES: readonly Guide[] = [
	{
		title: "Define a subgraph",
		description: "Sources, schema and handlers in one TypeScript file.",
		href: "/docs/subgraphs#define-a-subgraph",
	},
	{
		title: "Test before you deploy",
		description: "Run real blocks through your handlers and see rows written.",
		href: "/docs/subgraphs#test-before-you-deploy",
	},
	{
		title: "Tip-first deploys",
		description: "Go live at the current block while history backfills.",
		href: "/docs/subgraphs#tip-first-deploys",
	},
	{
		title: "Read rows",
		description: "Query your tables over REST or from the SDK.",
		href: "/docs/subgraphs#read-rows",
	},
];

/** No subgraphs yet: say what one is, hand over the deploy command and a
 *  prompt for the person's agent, with the guides beside it. */
export function SubgraphsEmptyState() {
	return (
		<EmptyStart
			guides={SUBGRAPH_GUIDES}
			docsHref="/docs/subgraphs"
			docsLabel="Subgraphs docs"
		>
			<StatusSentence>No subgraphs yet.</StatusSentence>
			<p>
				A subgraph turns chain events into your own tables. Write one in
				TypeScript and deploy it from your terminal. It shows up here with its
				lag behind the tip, rows written and handler errors.
			</p>
			<CliLine command="sl subgraphs deploy ./subgraphs/<name>.ts" />
			<CopyForAgent
				prompt={getAgentPrompt("subgraph-create")}
				hint="Your agent asks what to index, then builds it with you."
			/>
		</EmptyStart>
	);
}
