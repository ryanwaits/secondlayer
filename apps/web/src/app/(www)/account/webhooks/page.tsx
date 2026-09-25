"use client";

import { WebhooksListSection } from "@/components/account/webhooks/list-panel";

export default function AccountWebhooksPage() {
	return (
		<>
			<h1 className="acct-h1">Webhooks</h1>
			<p className="acct-lede">
				We POST matching chain events to your URL as each block lands, signed,
				with retries. You create and edit webhooks from the CLI or SDK; this
				page is for watching and fixing them.
			</p>
			<WebhooksListSection />
		</>
	);
}
