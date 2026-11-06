import { AccountOverview } from "@/components/account/overview/account-overview";
import {
	FirstRowsCode,
	FirstRowsPrompt,
} from "@/components/account/overview/first-rows-code";
import { OverviewFallback } from "@/components/account/page-fallbacks";
import { AccountSeedProvider } from "@/lib/account-data";
import { InsightsSeed } from "@/lib/insights-store";
import {
	accountReads,
	subgraphsListReads,
	webhooksListReads,
} from "@/lib/server/dashboard-reads";
import { readInsights } from "@/lib/server/insights-read";
import { savedOpenChoices } from "@/lib/server/open-choices";
import { sessionToken } from "@/lib/server/session";
import { Suspense } from "react";

// Next to the API (Hetzner HEL/fsn1), and per request: the HTML carries one
// account's data, so it is never prerendered or shared.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

/** Sends the Overview's skeleton at once; the page's reads stream in behind it. */
export default function AccountOverviewPage() {
	return (
		<Suspense fallback={<OverviewFallback />}>
			<OverviewData />
		</Suspense>
	);
}

async function OverviewData() {
	const token = await sessionToken();
	const [account, webhooks, subgraphs, insights] = token
		? await Promise.all([
				accountReads(token, ["billing", "caps", "keys", "usage", "rows"]),
				webhooksListReads(token),
				subgraphsListReads(token),
				readInsights(token),
			])
		: [{}, null, null, null];
	const openChoices = await savedOpenChoices();
	return (
		<InsightsSeed insights={insights}>
			<AccountSeedProvider seed={account}>
				<AccountOverview
					firstRowsCode={<FirstRowsCode />}
					firstRowsPrompt={<FirstRowsPrompt />}
					openChoices={openChoices}
					initial={webhooks && subgraphs ? { webhooks, subgraphs } : null}
				/>
			</AccountSeedProvider>
		</InsightsSeed>
	);
}
