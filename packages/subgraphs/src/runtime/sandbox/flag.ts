import type { Subgraph } from "@secondlayer/shared/db";

/**
 * f071 Stage 2a — dark, flag-gated rollout of the sandboxed (Bun Worker)
 * handler-execution path. Two switches, both required:
 *
 *  - `SUBGRAPH_SANDBOX_WORKERS === "1"` (env, read once at module load,
 *    mirrors the `SUBGRAPH_CONCURRENCY`/`SUBGRAPH_SOURCE` idiom in
 *    `service.ts`/`subscription-plane.ts`) — the global CAPABILITY switch.
 *    Off by default; an operator must deliberately enable the sandbox
 *    machinery fleet-wide before any subgraph can use it.
 *  - `subgraphs.sandbox_workers` (per-row, migration 0109) — the per-tenant
 *    ROLLOUT switch. Off by default for every row (including new ones).
 *
 * Semantics: capability AND rollout, not OR. The global flag alone must
 * never route real traffic through the worker path — it only makes the path
 * reachable, so a specific subgraph's `sandbox_workers` column is what
 * actually decides whether ITS blocks run in-process (both flags' default
 * state) or through the sandbox. This lets Stage 2c cut subgraphs over one
 * at a time without a global switch flip affecting the rest of the fleet,
 * while Stage 2a/2b can still keep the whole capability off fleet-wide with
 * a single env var during dark-build and shadow-run testing.
 *
 * As of Stage 2a, no code path ever sets `sandbox_workers = true` — the
 * column only exists so Stage 2c has somewhere to flip. `sandboxEnabled`
 * with today's data (column false everywhere) always returns false
 * regardless of the env flag, so the existing in-process path is exercised
 * unconditionally until an operator both (a) sets the env flag and (b)
 * flips a specific subgraph's column — neither of which this plan does.
 */
export function sandboxWorkersGloballyEnabled(): boolean {
	return process.env.SUBGRAPH_SANDBOX_WORKERS === "1";
}

export function sandboxEnabled(
	subgraph: Pick<Subgraph, "sandbox_workers">,
): boolean {
	return sandboxWorkersGloballyEnabled() && subgraph.sandbox_workers === true;
}
