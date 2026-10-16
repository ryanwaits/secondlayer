"use client";

import { WebhookDetailSection } from "@/components/account/webhooks/detail-panel";
import { WebhookDetailSkeleton } from "@/components/account/webhooks/skeletons";
import { useParams } from "next/navigation";
import { Suspense } from "react";

export default function AccountWebhookDetailPage() {
	const params = useParams<{ id: string }>();
	const id = Array.isArray(params.id) ? params.id[0] : params.id;
	if (!id) return null;
	// The section reads `?hour=`, which needs a Suspense boundary.
	return (
		<Suspense fallback={<WebhookDetailSkeleton />}>
			<WebhookDetailSection id={id} />
		</Suspense>
	);
}
