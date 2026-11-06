import { WebhooksFallback } from "@/components/account/page-fallbacks";
import { Staged } from "@/components/account/staged";
import { WebhooksListSection } from "@/components/account/webhooks/list-panel";
import { InsightsSeed } from "@/lib/insights-store";
import { webhooksListReads } from "@/lib/server/dashboard-reads";
import { savedIndexViews } from "@/lib/server/index-view";
import { readInsights } from "@/lib/server/insights-read";
import { sessionToken } from "@/lib/server/session";

// Next to the API (Hetzner HEL/fsn1), and per request: the HTML carries one
// account's data, so it is never prerendered or shared.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

export default function AccountWebhooksPage() {
	return (
		<Staged load={loadWebhooks()} fallback={<WebhooksFallback />}>
			{(data) => <WebhooksData {...data} />}
		</Staged>
	);
}

async function loadWebhooks() {
	const [token, views] = await Promise.all([sessionToken(), savedIndexViews()]);
	const [initial, insights] = token
		? await Promise.all([webhooksListReads(token), readInsights(token)])
		: [null, null];
	return { views, initial, insights };
}

function WebhooksData({
	views,
	initial,
	insights,
}: Awaited<ReturnType<typeof loadWebhooks>>) {
	return (
		<InsightsSeed insights={insights}>
			<WebhooksListSection
				initial={initial}
				initialView={views.webhooks ?? "rows"}
			/>
		</InsightsSeed>
	);
}
