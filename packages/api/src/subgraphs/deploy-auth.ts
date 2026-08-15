import { isPlatformMode } from "@secondlayer/shared/mode";

/**
 * Hosted commerce gates: paid-deploy expiry (x402 TTL) and wallet-ghost
 * identity. OSS has none of these — deploy, reindex, and backfill need no
 * accounts, credits, or x402 state. Deploys themselves are open on every
 * instance; the only metered surface is archive-data access.
 */
export function commerceGatesEnabled(): boolean {
	return isPlatformMode();
}
