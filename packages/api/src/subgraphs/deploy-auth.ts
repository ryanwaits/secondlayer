import { isPlatformMode } from "@secondlayer/shared/mode";

/**
 * Hosted deploy authorization: plan, trial, slot quota, genesis clamp,
 * expiry, and wallet-ghost identity. OSS has none of these — deploy,
 * reindex, and backfill need no accounts, credits, or x402 state.
 */
export function commerceGatesEnabled(): boolean {
	return isPlatformMode();
}
