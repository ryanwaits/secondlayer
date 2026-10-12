"use client";

import { useAccountData } from "./account-data";
import { type Problem, accountProblems } from "./account-health";
import { useWebhooksCache } from "./webhooks-store";

/** The current needs-attention list from whatever the stores already hold. */
export function useAccountProblems(): Problem[] {
	const { billing, burn, service, caps } = useAccountData();
	const { list } = useWebhooksCache();
	return accountProblems({
		billing,
		burn,
		service,
		caps,
		webhooks: list?.data ?? null,
	});
}
