"use client";

import { WebhookDetailSection } from "@/components/account/webhooks/detail-panel";
import { useParams } from "next/navigation";

export default function AccountWebhookDetailPage() {
	const params = useParams<{ id: string }>();
	const id = Array.isArray(params.id) ? params.id[0] : params.id;
	if (!id) return null;
	return <WebhookDetailSection id={id} />;
}
