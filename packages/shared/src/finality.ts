/**
 * Block finality, anchored to the burn (Bitcoin) chain.
 *
 * Post-Nakamoto, Stacks blocks arrive every few seconds, so a fixed count of
 * Stacks blocks is a poor finality proxy (e.g. 144 fast blocks ≈ 12 minutes).
 * A Stacks block is final once its anchoring burn block has enough Bitcoin
 * confirmations — so finality is expressed in burn-block confirmations and
 * mapped to a Stacks height via the burn_block_height carried on each block.
 */

/** Bitcoin confirmations required before a block is treated as final. ~1 hour. */
export const DEFAULT_BTC_CONFIRMATIONS = 6;

/**
 * Highest burn (Bitcoin) block height considered finalized given the current
 * burn tip. Stacks blocks whose `burn_block_height` is at or below the result
 * are final. Returns 0 when the chain is shorter than the confirmation window.
 */
export function finalizedBurnHeight(
	burnTipHeight: number,
	confirmations: number = DEFAULT_BTC_CONFIRMATIONS,
): number {
	if (!Number.isInteger(burnTipHeight) || burnTipHeight < 0) {
		throw new Error("burnTipHeight must be a non-negative integer");
	}
	if (!Number.isInteger(confirmations) || confirmations < 0) {
		throw new Error("confirmations must be a non-negative integer");
	}
	return Math.max(0, burnTipHeight - confirmations);
}
