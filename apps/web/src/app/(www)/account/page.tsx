import { AccountOverview } from "@/components/account/overview/account-overview";
import {
	FirstRowsCode,
	FirstRowsPrompt,
} from "@/components/account/overview/first-rows-code";
import { AccountSeedProvider } from "@/lib/account-data";
import { InsightsSeed } from "@/lib/insights-store";
import {
	accountReads,
	subgraphsListReads,
	webhooksListReads,
} from "@/lib/server/dashboard-reads";
import { readInsights } from "@/lib/server/insights-read";
import { getTiming } from "@/lib/server/render-timing";
import { sessionToken } from "@/lib/server/session";

// Next to the API (Hetzner HEL/fsn1), and per request: the HTML carries one
// account's data, so it is never prerendered or shared.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

export default async function AccountOverviewPage({
	searchParams,
}: {
	searchParams: Promise<{ timing?: string | string[] }>;
}) {
	const timing = getTiming().enableFrom(await searchParams);
	const token = await sessionToken();
	const [account, webhooks, subgraphs, insights] = token
		? await timing.step("page:reads", () =>
				Promise.all([
					accountReads(token, ["billing", "caps", "keys", "usage", "rows"]),
					webhooksListReads(token),
					subgraphsListReads(token),
					readInsights(token),
				]),
			)
		: [{}, null, null, null];
	const timingScript = await timing.script();
	return (
		<InsightsSeed insights={insights}>
			<AccountSeedProvider seed={account}>
				<AccountOverview
					firstRowsCode={<FirstRowsCode />}
					firstRowsPrompt={<FirstRowsPrompt />}
					initial={webhooks && subgraphs ? { webhooks, subgraphs } : null}
				/>
			</AccountSeedProvider>
			{timingScript}
		</InsightsSeed>
	);
}
