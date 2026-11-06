import { KeysScreen } from "@/components/account/keys/keys-screen";
import { KeysFallback } from "@/components/account/page-fallbacks";
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

export default function AccountKeysPage() {
	return (
		<Staged load={loadKeys()} fallback={<KeysFallback />}>
			{(data) => <KeysData {...data} />}
		</Staged>
	);
}

async function loadKeys() {
	const token = await sessionToken();
	const [account, insights] = token
		? await Promise.all([
				accountReads(token, ["keys", "apps"]),
				readInsights(token),
			])
		: [{}, null];
	return { account, insights };
}

function KeysData({ account, insights }: Awaited<ReturnType<typeof loadKeys>>) {
	return (
		<InsightsSeed insights={insights}>
			<AccountSeedProvider seed={account}>
				<KeysScreen />
			</AccountSeedProvider>
		</InsightsSeed>
	);
}
