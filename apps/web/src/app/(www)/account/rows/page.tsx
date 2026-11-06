import { RowsFallback } from "@/components/account/page-fallbacks";
import { RowsSection } from "@/components/account/rows/rows-panel";
import { Staged } from "@/components/account/staged";
import { AccountSeedProvider } from "@/lib/account-data";
import { InsightsSeed } from "@/lib/insights-store";
import { accountReads } from "@/lib/server/dashboard-reads";
import { readInsights } from "@/lib/server/insights-read";
import { sessionToken } from "@/lib/server/session";

// Next to the API (Hetzner HEL/fsn1), and per request: the HTML carries one
// account's data, so it is never prerendered or shared.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

export default function AccountRowsPage() {
	return (
		<Staged load={loadRows()} fallback={<RowsFallback />}>
			{(data) => <RowsData {...data} />}
		</Staged>
	);
}

async function loadRows() {
	const token = await sessionToken();
	const [account, insights] = token
		? await Promise.all([
				accountReads(token, ["rows", "keys"]),
				readInsights(token),
			])
		: [{}, null];
	return { account, insights };
}

function RowsData({ account, insights }: Awaited<ReturnType<typeof loadRows>>) {
	return (
		<InsightsSeed insights={insights}>
			<AccountSeedProvider seed={account}>
				<RowsSection />
			</AccountSeedProvider>
		</InsightsSeed>
	);
}
