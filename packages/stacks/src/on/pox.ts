import {
	type FactoryTarget,
	type SubscriptionFilterSpec,
	makeSpec,
} from "./spec.ts";

export type PoxFunction =
	| "stack-stx"
	| "stack-extend"
	| "stack-increase"
	| "delegate-stx"
	| "revoke-delegate-stx"
	| "delegate-stack-stx"
	| "delegate-stack-extend"
	| "delegate-stack-increase"
	| "stack-aggregation-commit"
	| "stack-aggregation-commit-indexed"
	| "stack-aggregation-increase"
	| "set-signer-key-authorization";

/**
 * Match PoX-4 stacking calls. Bind against a subgraph table mirroring
 * `pox4_calls` (function_name, stacker, caller, ...). Scaffold via
 * `sl subgraphs create --template pox-stacking`.
 *
 * @param fn restrict to one PoX-4 function; omit to fire on every call
 */
export function poxStack(
	target: FactoryTarget,
	fn?: PoxFunction,
	opts?: { stacker?: string; signerKey?: string },
): SubscriptionFilterSpec {
	return makeSpec(target, {
		...(fn && { function_name: fn }),
		...(opts?.stacker && { stacker: opts.stacker }),
		...(opts?.signerKey && { signer_key: opts.signerKey }),
	});
}
