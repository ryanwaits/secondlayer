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
	stacks: string;
	asset: string;
	erc20: string;
	decimals: number;
	cap: number;
	example: string;
};

export const BRIDGE_TOKENS: readonly BridgeToken[] = [
	{
		symbol: "PEPE",
		stacks:
			"SP1Z92MPDQEWZXW36VX71Q25HKF5K2EPCJ304F275.tokensoft-token-v4k68639zxz",
		asset: "tokensoft-token",
		erc20: "0x3dfed812c24d74e263293f89df1e8ff953526a72",
		decimals: 3,
		cap: 1_000_000,
		example: "100",
	},
	{
		symbol: "MEGA",
		stacks: "SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335.mega",
		asset: "mega",
		erc20: "0xf98af8c29470674a6e1f33ec587daa012f0a35c3",
		decimals: 2,
		cap: 10_000,
		example: "25",
	},
];

export type RoundTrip = {
	stacksAddress: string;
	token: BridgeToken["symbol"];
	amount: string;
	lock: string;
	mint: string;
	burn: string;
	release: string;
};

export const ROUND_TRIPS: readonly RoundTrip[] = [];

export function shortAddress(address: string): string {
	return address.length <= 12
		? address
		: `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export type BaseUnits =
	| { ok: true; units: string; overCap: boolean }
	| { ok: false; reason: "empty" | "invalid" | "decimals" };

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
