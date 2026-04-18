/**
 * Unsigned transaction intents for workflow use.
 *
 *   import { tx } from "@secondlayer/stacks/tx"
 *   await step.run("pay", () => broadcast(
 *     tx.transfer({ recipient: "SP…", amount: 1_000_000n, memo: "DCA" }),
 *     { signer: "treasury" },
 *   ))
 *
 * These helpers return plain "intent" objects — a description of *what*
 * should be broadcast, without fee, nonce, signer, or signature. The
 * `broadcast()` step (see Sprint 4) hydrates those at submit time using the
 * configured signer.
 *
 * Keeping intents separate from the existing `buildTokenTransfer` /
 * `buildContractCall` / `buildContractDeploy` in `@secondlayer/stacks/transactions`
 * means workflow authors don't have to manage fee/nonce and a single
 * `broadcast()` path can enforce budget caps + safety layers uniformly.
 */

import type { ClarityValue, PostCondition } from "@stacks/transactions";

export interface TransferIntent {
	kind: "transfer";
	recipient: string;
	amount: bigint;
	memo?: string;
	postConditions?: PostCondition[];
}

export interface ContractCallIntent {
	kind: "contract-call";
	/** Fully-qualified contract id, e.g. `"SP000000000000000000002Q6VF78.bns"`. */
	contract: string;
	fn: string;
	args: ClarityValue[];
	postConditions?: PostCondition[];
}

export interface DeployIntent {
	kind: "deploy";
	name: string;
	source: string;
	clarityVersion?: 1 | 2 | 3;
}

export interface MultiSendIntent {
	kind: "multisend";
	payments: Array<{ recipient: string; amount: bigint; memo?: string }>;
}

export type TxIntent =
	| TransferIntent
	| ContractCallIntent
	| DeployIntent
	| MultiSendIntent;

/**
 * Lightweight factory functions for building tx intents. Identity-shaped
 * with a `kind` tag so the broadcast step can discriminate at runtime.
 */
export const tx = {
	transfer: (opts: Omit<TransferIntent, "kind">): TransferIntent => ({
		kind: "transfer",
		...opts,
	}),
	contractCall: (
		opts: Omit<ContractCallIntent, "kind">,
	): ContractCallIntent => ({ kind: "contract-call", ...opts }),
	deploy: (opts: Omit<DeployIntent, "kind">): DeployIntent => ({
		kind: "deploy",
		...opts,
	}),
	multisend: (opts: Omit<MultiSendIntent, "kind">): MultiSendIntent => ({
		kind: "multisend",
		...opts,
	}),
} as const;
