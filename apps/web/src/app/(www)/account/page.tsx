import { AccountOverview } from "@/components/account/overview/account-overview";
import {
	FirstRowsCode,
	FirstRowsPrompt,
} from "@/components/account/overview/first-rows-code";
import { type AccountSeed, AccountSeedProvider } from "@/lib/account-data";
import { InsightsSeed } from "@/lib/insights-store";
import { firstRowsGuideMayShow } from "@/lib/onboarding";
import {
	accountReads,
	subgraphsListReads,
	webhooksListReads,
} from "@/lib/server/dashboard-reads";
import { readInsights } from "@/lib/server/insights-read";
import { savedOpenChoices } from "@/lib/server/open-choices";
import { sessionToken } from "@/lib/server/session";

// Next to the API (Hetzner HEL/fsn1), and per request: the HTML carries one
// account's data, so it is never prerendered or shared.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

export default async function AccountOverviewPage() {
	const token = await sessionToken();
	const [account, webhooks, subgraphs, insights] = token
		? await Promise.all([
				accountReads(token, ["billing", "caps", "keys", "usage", "rows"]),
				webhooksListReads(token),
				subgraphsListReads(token),
				readInsights(token),
			])
		: [{} as AccountSeed, null, null, null];
	const openChoices = await savedOpenChoices();
	// The highlighted blocks are for the new-account guide only; every other
	// visit skips the highlighter.
	const pushed =
		(webhooks?.list.kind === "ok" && webhooks.list.data.length > 0) ||
		(subgraphs?.kind === "ok" && subgraphs.data.length > 0);
	const guide = firstRowsGuideMayShow(account.keys ?? null, new Date(), pushed);
	return (
		<InsightsSeed insights={insights}>
			<AccountSeedProvider seed={account}>
				<AccountOverview
					firstRowsCode={guide ? <FirstRowsCode /> : null}
					firstRowsPrompt={guide ? <FirstRowsPrompt /> : null}
					openChoices={openChoices}
					initial={webhooks && subgraphs ? { webhooks, subgraphs } : null}
				/>
			</AccountSeedProvider>
		</InsightsSeed>
	);
}
