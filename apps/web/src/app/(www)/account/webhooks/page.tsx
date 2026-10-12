"use client";

import { AccountHead } from "@/components/account/parts";
import { WebhooksListSection } from "@/components/account/webhooks/list-panel";

export default function AccountWebhooksPage() {
	return (
		<>
			<AccountHead
				title="Webhooks"
				sub="Matching chain events are POSTed to your URL as each block lands, signed, with retries. Create and edit from the CLI or SDK; watch and fix them here."
			/>
			<WebhooksListSection />
		</>
	);
}
