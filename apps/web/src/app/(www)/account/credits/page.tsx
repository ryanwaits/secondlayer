import { AccountSeedProvider } from "@/lib/account-data";
import { InsightsSeed } from "@/lib/insights-store";
import { accountReads } from "@/lib/server/dashboard-reads";
import { readInsights } from "@/lib/server/insights-read";
import { sessionToken } from "@/lib/server/session";
import { AccountCreditsPage } from "./credits-page";

// Next to the API (Hetzner HEL/fsn1), and per request: the HTML carries one
// account's data, so it is never prerendered or shared.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

export default async function AccountBillingPage() {
	const token = await sessionToken();
	const [account, insights] = token
		? await Promise.all([
				accountReads(token, ["billing", "caps", "credits", "usage", "alerts"]),
				readInsights(token),
			])
		: [{}, null];
	return (
		<InsightsSeed insights={insights}>
			<AccountSeedProvider seed={account}>
				<AccountCreditsPage />
			</AccountSeedProvider>
		</InsightsSeed>
	);
}
