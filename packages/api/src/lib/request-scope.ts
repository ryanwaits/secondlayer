import { isPlatformMode } from "@secondlayer/shared/mode";
import type { Context } from "hono";
import { getAccountId } from "./ownership.ts";

/**
 * Platform routes are multi-tenant and require a real account id.
 * Dedicated/OSS routes run against one tenant DB and use the empty account id.
 */
export function getTenantScopedAccountId(c: Context): string | null {
	const accountId = getAccountId(c);
	if (isPlatformMode()) return accountId ?? null;
	return "";
}
