import { Staged } from "@/components/account/staged";
import { InsightsSeed } from "@/lib/insights-store";
import { readInsights } from "@/lib/server/insights-read";
import { sessionToken } from "@/lib/server/session";
import { InsightsPage } from "./insights-page";

// Next to the API (Hetzner HEL/fsn1), and per request: the HTML carries one
// account's data, so it is never prerendered or shared.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

export default function AccountInsightsPage() {
	return (
		<Staged load={loadInsights()} fallback={null}>
			{(insights) => (
				<InsightsSeed insights={insights}>
					<InsightsPage />
				</InsightsSeed>
			)}
		</Staged>
	);
}

async function loadInsights() {
	const token = await sessionToken();
	return token ? await readInsights(token) : null;
}
