import { WebhookDetailSection } from "@/components/account/webhooks/detail-panel";
import { WebhookDetailSkeleton } from "@/components/account/webhooks/skeletons";
import { InsightsSeed } from "@/lib/insights-store";
import { webhookDetailReads } from "@/lib/server/dashboard-reads";
import { readInsights } from "@/lib/server/insights-read";
import { getTiming } from "@/lib/server/render-timing";
import { sessionToken } from "@/lib/server/session";
import { Suspense } from "react";

// Next to the API (Hetzner HEL/fsn1), and per request: the HTML carries one
// account's data, so it is never prerendered or shared.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

export default async function AccountWebhookDetailPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ timing?: string | string[] }>;
}) {
	const { id } = await params;
	const timing = getTiming().enableFrom(await searchParams);
	const token = await sessionToken();
	const [initial, insights] = token
		? await timing.step("page:reads", () =>
				Promise.all([webhookDetailReads(token, id), readInsights(token)]),
			)
		: [null, null];
	const timingScript = await timing.script();
	// The section reads `?hour=`, which needs a Suspense boundary.
	return (
		<InsightsSeed insights={insights}>
			<Suspense fallback={<WebhookDetailSkeleton />}>
				<WebhookDetailSection id={id} initial={initial} />
			</Suspense>
			{timingScript}
		</InsightsSeed>
	);
}
