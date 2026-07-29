/**
 * Stacks hard-fork epoch activation heights, as Bitcoin burn block heights.
 *
 * Epoch 4.0 carries both SIP-044 (the native Bitcoin SPV built-ins / Clarity 6)
 * and SIP-045 (`pox-5` Bitcoin Staking) — one fork, one height. Keep it here so
 * the two modules can never disagree.
 */

/**
 * Epoch 4.0 activation height on mainnet — Bitcoin block 960,230 (~2026-07-30
 * AM UTC, per the stacks-core 4.0.1 release notes).
 *
 * Only mainnet has a fixed height. On other networks, read it from the node
 * (`getPox5Activation` for pox-5) or pass it explicitly.
 */
export const EPOCH_4_ACTIVATION_BURN_HEIGHT_MAINNET = 960_230;
