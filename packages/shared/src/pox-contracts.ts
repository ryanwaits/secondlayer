/**
 * Which PoX boot contract was live at a given Bitcoin (burn) height on mainnet.
 *
 * Stacking locks (`stx_lock`) are only ever emitted by the PoX contract of the
 * epoch they land in. Rows ingested before ~7.46M didn't record that contract,
 * so Streams derives it from the block's burn height. Epoch boundaries are
 * burn heights (stacks-core mainnet config); verified against every stored
 * lock: no stored `contract_identifier` and no direct boot-contract call
 * disagrees with this table.
 *
 * Mainnet only: other networks have their own heights and boot address, and
 * their rows always carry the contract.
 */

const BOOT = "SP000000000000000000002Q6VF78";

/** Each era starts at `fromBurnHeight` (inclusive) and runs until the next. */
export const MAINNET_POX_CONTRACT_ERAS: readonly {
	fromBurnHeight: number;
	contractId: string;
}[] = [
	{ fromBurnHeight: 0, contractId: `${BOOT}.pox` },
	{ fromBurnHeight: 781_551, contractId: `${BOOT}.pox-2` },
	{ fromBurnHeight: 789_250, contractId: `${BOOT}.pox-3` },
	{ fromBurnHeight: 840_360, contractId: `${BOOT}.pox-4` },
	{ fromBurnHeight: 960_230, contractId: `${BOOT}.pox-5` },
];

/** The mainnet PoX contract live at `burnHeight`. */
export function mainnetPoxContractAt(burnHeight: number): string {
	let contractId = MAINNET_POX_CONTRACT_ERAS[0].contractId;
	for (const era of MAINNET_POX_CONTRACT_ERAS) {
		if (burnHeight >= era.fromBurnHeight) contractId = era.contractId;
	}
	return contractId;
}

/** True for a PoX contract on any network (`<deployer>.pox`, `.pox-N`). Wide
 *  on purpose: it only decides whether a filter needs its stx_lock branch. */
export function isPoxContractId(contractId: string): boolean {
	return /\.pox(-\d+)?$/.test(contractId);
}
