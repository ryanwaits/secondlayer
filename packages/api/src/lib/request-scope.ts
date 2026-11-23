import {
	isPlatformMode,
	isTestnetWebhookStack,
} from "@secondlayer/shared/mode";
import type { Context } from "hono";
import { getAccountId } from "./ownership.ts";

export function getTenantScopedAccountId(c: Context): string | null {
	if (isTestnetWebhookStack()) {
		return c.req.header("x-secondlayer-account-id")?.trim() || null;
	}
	const accountId = getAccountId(c);
	if (isPlatformMode()) return accountId ?? null;
	return "";
}
