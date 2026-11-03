import { WebhookDetailSection } from "@/components/account/webhooks/detail-panel";
import { WebhookDetailSkeleton } from "@/components/account/webhooks/skeletons";
import { webhookDetailReads } from "@/lib/server/dashboard-reads";
import { sessionToken } from "@/lib/server/session";
import { Suspense } from "react";

// Next to the API (Hetzner HEL/fsn1), and per request: the HTML carries one
// account's data, so it is never prerendered or shared.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

export default async function AccountWebhookDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const token = await sessionToken();
	const initial = token ? await webhookDetailReads(token, id) : null;
	// The section reads `?hour=`, which needs a Suspense boundary.
	return (
		<Suspense fallback={<WebhookDetailSkeleton />}>
			<WebhookDetailSection id={id} initial={initial} />
		</Suspense>
	);
}
