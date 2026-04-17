/**
 * Memoization key derivation for workflow steps (v2).
 *
 * ## Spec
 *
 * Memo key = `sha256(stepId + canonicalJSON(stableInputs))`
 *
 * Where `stableInputs` is a per-primitive projection of the step's inputs:
 *
 * | Primitive            | stableInputs |
 * |----------------------|--------------|
 * | `step.run`           | `{ bundleHash }` — fn body unhashable; bundle-level edits invalidate cache |
 * | `step.generateObject`| `{ prompt, system, model, schemaFingerprint, toolSetFingerprint }` |
 * | `step.generateText`  | `{ prompt, system, model, toolSetFingerprint, maxSteps }` |
 * | `step.render`        | `{ prompt, system, model, catalogFingerprint, context }` |
 * | `step.query`         | `{ subgraph, table, where, orderBy, limit, offset }` |
 * | `step.count`         | `{ subgraph, table, where }` |
 * | `step.deliver`       | `{ target }` |
 * | `step.sleep`         | `{ ms }` |
 * | `step.invoke`        | `{ workflow, input }` |
 * | `step.broadcast`     | `{ txHash, signer, awaitConfirmation, minConfirmations }` |
 *
 * ## Sub-step keys (tool calls inside `generateText`/`generateObject`)
 *
 * Each tool call inside an AI step gets its own memo row, keyed:
 *
 *   `sha256(parentStepId + toolName + canonicalJSON(args))`
 *
 * No call-index is included. Two identical (toolName, args) pairs within the
 * same parent dedupe to one cache row — tools are assumed idempotent. If AI
 * reorders calls across retries, the cache still serves correctly because
 * the key is content-based.
 *
 * Parent step is memoized as a whole; on retry, tool calls that previously
 * succeeded return cached results instead of re-invoking `execute`.
 *
 * ## Behaviour change vs v1
 *
 * v1 memo key was `(run_id, step_id)` — editing a prompt in the source kept
 * the cached output silently. v2 hashes inputs so authoring changes are
 * visible on the next run. This is intentional and documented as a breaking
 * change.
 *
 * ## Canonicalization
 *
 * `canonicalJSON` must produce deterministic output:
 *   - keys sorted alphabetically at every object level
 *   - no whitespace
 *   - `undefined` / functions omitted (JSON.stringify default)
 *   - `BigInt` serialized as `"${value}n"` string
 *   - symbols thrown on
 */

import { createHash } from "node:crypto";

/**
 * Canonical JSON serialization — stable output across runs regardless of
 * property insertion order or `BigInt` presence.
 */
export function canonicalJSON(value: unknown): string {
	return JSON.stringify(value, (_key, v) => {
		if (typeof v === "bigint") return `${v}n`;
		if (typeof v === "symbol")
			throw new TypeError("symbol is not serializable in memo key");
		if (v && typeof v === "object" && !Array.isArray(v)) {
			const sorted: Record<string, unknown> = {};
			for (const k of Object.keys(v as Record<string, unknown>).sort()) {
				sorted[k] = (v as Record<string, unknown>)[k];
			}
			return sorted;
		}
		return v;
	});
}

/**
 * Compute the memo key for a given step.
 * @param stepId      User-supplied step identifier (first arg to `step.*`)
 * @param stableInputs Per-primitive projection (see table above)
 */
export function memoKey(stepId: string, stableInputs: unknown): string {
	const payload = `${stepId}\u0000${canonicalJSON(stableInputs)}`;
	return createHash("sha256").update(payload).digest("hex");
}

/**
 * Compute a sub-step key for a tool call inside an AI step.
 */
export function subStepKey(
	parentStepId: string,
	toolName: string,
	args: unknown,
): string {
	const payload = `${parentStepId}\u0000${toolName}\u0000${canonicalJSON(args)}`;
	return createHash("sha256").update(payload).digest("hex");
}
