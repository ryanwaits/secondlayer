import type { Subgraph } from "@secondlayer/shared/db";

/**
 * f071 Stage A — dark, flag-gated rollout of the sandboxed (per-tenant OS
 * subprocess — ported from the disproven Bun Worker substrate, spike doc
 * §10) handler-execution path. Two switches, both required:
 *
 *  - `SUBGRAPH_SANDBOX_WORKERS === "1"` (env, read at call time — mirrors
 *    the `SUBGRAPH_CONCURRENCY`/`SUBGRAPH_SOURCE` idiom in
 *    `service.ts`/`subscription-plane.ts`) — the global CAPABILITY switch.
 *    Off by default; an operator must deliberately enable the sandbox
 *    machinery fleet-wide before any subgraph can use it.
 *  - `subgraphs.sandbox_workers` (per-row, migration 0109) — the per-tenant
 *    ROLLOUT switch. Off by default for every row (including new ones).
 *
 * Semantics: capability AND rollout, not OR. The global flag alone must
 * never route real traffic through the sandbox path — it only makes the path
 * reachable, so a specific subgraph's `sandbox_workers` column is what
 * actually decides whether ITS blocks run in-process (both flags' default
 * state) or through the sandbox. This lets a future cutover stage cut
 * subgraphs over one at a time without a global switch flip affecting the
 * rest of the fleet, while the dark-build/shadow-run stages can still keep
 * the whole capability off fleet-wide with a single env var.
 *
 * As of Stage A, no code path ever sets `sandbox_workers = true` — the
 * column only exists so a future cutover stage has somewhere to flip.
 * `sandboxEnabled` with today's data (column false everywhere) always
 * returns false regardless of the env flag, so the existing in-process path
 * is exercised unconditionally until an operator both (a) sets the env flag
 * and (b) flips a specific subgraph's column — neither of which this plan
 * does.
 */
export function sandboxWorkersGloballyEnabled(): boolean {
	return process.env.SUBGRAPH_SANDBOX_WORKERS === "1";
}

export function sandboxEnabled(
	subgraph: Pick<Subgraph, "sandbox_workers">,
): boolean {
	return sandboxWorkersGloballyEnabled() && subgraph.sandbox_workers === true;
}
