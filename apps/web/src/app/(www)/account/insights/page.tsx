import { InsightsSeed } from "@/lib/insights-store";
import { readInsights } from "@/lib/server/insights-read";
import { sessionToken } from "@/lib/server/session";
import { InsightsPage } from "./insights-page";

// Next to the API (Hetzner HEL/fsn1), and per request: the HTML carries one
// account's data, so it is never prerendered or shared.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

export default async function AccountInsightsPage() {
	const token = await sessionToken();
	const insights = token ? await readInsights(token) : null;
	return (
		<InsightsSeed insights={insights}>
			<InsightsPage />
		</InsightsSeed>
	);
}
