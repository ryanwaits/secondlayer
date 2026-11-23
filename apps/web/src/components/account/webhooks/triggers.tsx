import type { ChainTrigger, WebhookActivity } from "@secondlayer/sdk";
import type { ChainTriggerType } from "@secondlayer/sdk/webhooks/triggers";

export const TRIGGER_NOUN: Record<ChainTriggerType, string> = {
	stx_transfer: "STX transfer",
	stx_mint: "STX mint",
	stx_burn: "STX burn",
	stx_lock: "STX lock",
	ft_transfer: "token transfer",
	ft_mint: "token mint",
	ft_burn: "token burn",
	nft_transfer: "NFT transfer",
	nft_mint: "NFT mint",
	nft_burn: "NFT burn",
	contract_call: "contract call",
	contract_deploy: "contract deploy",
	print_event: "contract print event",
	nested_contract_call: "nested contract call",
	var_set: "data-var write",
	map_set: "map write",
	map_insert: "map insert",
	map_delete: "map delete",
	sbtc_deposit: "sBTC deposit",
	sbtc_withdrawal_create: "sBTC withdrawal request",
	sbtc_withdrawal_accept: "sBTC withdrawal accept",
	sbtc_withdrawal_reject: "sBTC withdrawal reject",
	sbtc_withdrawal_swept_confirmed: "sBTC withdrawal sweep",
	rune_etch: "rune etch",
	rune_mint: "rune mint",
	rune_transfer: "rune transfer",
	rune_burn: "rune burn",
};

export const SENTENCE_FIELD_ORDER = [
	"assetIdentifier",
	"contractId",
	"deployer",
	"contractName",
	"functionName",
	"caller",
	"varName",
	"map",
	"topic",
	"where",
	"lockedAddress",
	"bitcoinTxid",
	"sweepTxid",
	"requestId",
	"trait",
	"sender",
	"recipient",
	"rune",
	"address",
	"minAmount",
	"maxAmount",
] as const;

export function chainEventType(triggerType: ChainTriggerType): string {
	return `chain.${triggerType}.apply`;
}

export function triggerVolume(
	trigger: ChainTrigger,
	allTriggers: ChainTrigger[],
	activity: WebhookActivity | null,
): { count: number; shared: boolean } {
	const count = activity?.byEventType[chainEventType(trigger.type)] ?? 0;
	const shared = allTriggers.filter((t) => t.type === trigger.type).length > 1;
	return { count, shared };
}

export function perDay(count: number): number {
	return Math.round(count / 7);
}
