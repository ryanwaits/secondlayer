/**
 * Mainnet facts for the Stacks ⇄ Robinhood Chain bridge, shared by /robinhood
 * and its phase 0 guide. Public data only, from robinhood-bridge
 * deployments/mainnet.json and its evidence log.
 */

export const HIRO_MAINNET_TX = "https://explorer.hiro.so/txid/";
export const RH_MAINNET_TX = "https://robinhoodchain.blockscout.com/tx/";
export const RH_MAINNET_ADDRESS =
	"https://robinhoodchain.blockscout.com/address/";

export const hiroTx = (txid: string) =>
	`${HIRO_MAINNET_TX}${txid}?chain=mainnet`;
export const rhTx = (hash: string) => `${RH_MAINNET_TX}${hash}`;
export const hiroAddress = (address: string) =>
	`https://explorer.hiro.so/address/${address}?chain=mainnet`;

export const LOCKER = "SP1W6RETVA7YJ8N392A35S3T60AMZN1VMMEZRZH5S.locker";
export const LOCKER_SANDBOX = `https://explorer.hiro.so/sandbox/contract-call/${LOCKER}?chain=mainnet`;

export const ROBINHOOD_CHAIN = {
	name: "Robinhood Chain",
	rpc: "https://rpc.mainnet.chain.robinhood.com",
	chainId: "4663",
	currency: "ETH",
	explorer: "https://robinhoodchain.blockscout.com",
} as const;

export type BridgeToken = {
	symbol: "MEGA" | "PEPE";
	/** The SIP-010 contract on Stacks. */
	stacks: string;
	/** Its ERC-20 twin on Robinhood Chain. */
	erc20: string;
	decimals: number;
	/** Whole tokens, for everyone together. */
	cap: number;
	/** A sensible first amount, in whole tokens. */
	example: string;
};

/** Tokens bridging now, in the order the guide offers them. */
export const BRIDGE_TOKENS: readonly BridgeToken[] = [
	{
		symbol: "MEGA",
		stacks: "SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335.mega",
		erc20: "0xf98af8c29470674a6e1f33ec587daa012f0a35c3",
		decimals: 2,
		cap: 10_000,
		example: "25",
	},
	{
		symbol: "PEPE",
		stacks:
			"SP1Z92MPDQEWZXW36VX71Q25HKF5K2EPCJ304F275.tokensoft-token-v4k68639zxz",
		erc20: "0x3dfed812c24d74e263293f89df1e8ff953526a72",
		decimals: 3,
		cap: 1_000_000,
		example: "100",
	},
];

export type RoundTrip = {
	/** The tester's Stacks address (the locker and the release recipient). */
	stacksAddress: string;
	token: BridgeToken["symbol"];
	/** Whole tokens, as shown. */
	amount: string;
	lock: string;
	mint: string;
	burn: string;
	release: string;
};

/**
 * Round trips run by someone other than the builder, newest first. Add a row
 * when a release lands: the four ids are in robinhood-bridge's
 * evidence-mainnet.jsonl. The list stays hidden on /robinhood while empty.
 */
export const ROUND_TRIPS: readonly RoundTrip[] = [];

/** `SP2J6Z…8RXK`: enough of each end to tell addresses apart. */
export function shortAddress(address: string): string {
	return address.length <= 12
		? address
		: `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export type BaseUnits =
	| { ok: true; units: string; overCap: boolean }
	| { ok: false; reason: "empty" | "invalid" | "decimals" };

/**
 * Whole tokens as typed (`25`, `1,000.5`) to the base units a contract call
 * takes, in exact integer math: 25 MEGA at 2 decimals is `2500`.
 */
export function toBaseUnits(input: string, token: BridgeToken): BaseUnits {
	const raw = input.trim().replaceAll(",", "");
	if (raw === "") return { ok: false, reason: "empty" };
	const match = /^(\d+)(?:\.(\d*))?$/.exec(raw);
	if (!match) return { ok: false, reason: "invalid" };
	const [, whole, fraction = ""] = match;
	if (fraction.length > token.decimals)
		return { ok: false, reason: "decimals" };
	const units = BigInt(whole + fraction.padEnd(token.decimals, "0"));
	if (units === 0n) return { ok: false, reason: "invalid" };
	const cap = BigInt(token.cap) * 10n ** BigInt(token.decimals);
	return { ok: true, units: units.toString(), overCap: units > cap };
}
