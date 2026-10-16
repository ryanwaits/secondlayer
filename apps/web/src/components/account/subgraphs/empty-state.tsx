import {
	KeyFirstLine,
	PlaceholderRows,
} from "@/components/dashboard/shell/onboarding";
import { StatusSentence } from "@/components/dashboard/shell/status-sentence";
import Link from "next/link";
import { CliLine } from "../webhooks/shared";

/** No subgraphs yet: say what one is and hand over the deploy command. */
export function SubgraphsEmptyState({ noKey = false }: { noKey?: boolean }) {
	return (
		<div className="sg-empty">
			<StatusSentence tone="idle">No subgraphs yet.</StatusSentence>
			<p>
				A subgraph turns chain events into your own tables. Write one in
				TypeScript and deploy it from your terminal. It shows up here with its
				lag behind the tip, rows written and handler errors.
			</p>
			{noKey ? <KeyFirstLine /> : null}
			<CliLine command="sl subgraphs deploy ./subgraphs/<name>.ts" />
			<p>
				<Link href="/docs/subgraphs" className="dash-link">
					Subgraphs guide ›
				</Link>
			</p>
			<PlaceholderRows
				rows={[
					{ state: 62, count: 44 },
					{ state: 50, count: 52 },
				]}
			/>
		</div>
	);
}
