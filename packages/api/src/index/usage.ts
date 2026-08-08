import {
	type ProductUsageBreakdown,
	getProductUsage,
} from "@secondlayer/platform/db/queries/usage";
import { getDb } from "@secondlayer/shared/db";

export type UsageReader = (accountId: string) => Promise<ProductUsageBreakdown>;

export const readUsage: UsageReader = (accountId) =>
	getProductUsage(getDb(), accountId);
