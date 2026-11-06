import { AccountOverview } from "@/components/account/overview/account-overview";
import {
	FirstRowsCode,
	FirstRowsPrompt,
} from "@/components/account/overview/first-rows-code";
import { OverviewFallback } from "@/components/account/page-fallbacks";
import { Staged } from "@/components/account/staged";
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

// Next to the API (Hetzner HEL/fsn1), and per request: the HTML carries one
// account's data, so it is never prerendered or shared.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

/** Sent whole when its reads land inside the head start; otherwise the
 *  skeleton goes first and the reads stream in behind it. */
export default function AccountOverviewPage() {
	return (
		<Staged load={loadOverview()} fallback={<OverviewFallback />}>
			{(data) => <OverviewData {...data} />}
		</Staged>
	);
}

async function loadOverview() {
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
	return { account, webhooks, subgraphs, insights, openChoices };
}

function OverviewData({
	account,
	webhooks,
	subgraphs,
	insights,
	openChoices,
}: Awaited<ReturnType<typeof loadOverview>>) {
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
