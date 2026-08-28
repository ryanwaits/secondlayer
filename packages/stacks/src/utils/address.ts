import { c32address, c32addressDecode } from "./c32.ts";
import { AddressVersion } from "./constants.ts";
import { bytesToHex, hexToBytes, without0x } from "./encoding.ts";
import { hash160 } from "./hash.ts";

export { c32address, c32addressDecode };

/**
 * Derive the single-sig Stacks address for a compressed public key.
 */
export function publicKeyToAddress(
	publicKey: string | Uint8Array,
	network: "mainnet" | "testnet" = "mainnet",
): string {
	const bytes =
		typeof publicKey === "string"
			? hexToBytes(without0x(publicKey))
			: publicKey;
	const version =
		network === "mainnet"
			? AddressVersion.MainnetSingleSig
			: AddressVersion.TestnetSingleSig;
	return c32address(version, bytesToHex(hash160(bytes)));
}

/** Clarity contract-name grammar: leading letter, then letters/digits/`-`/`_`.
 *  Underscore is legal (SIP-002) and deployed contracts use it — matches the
 *  pattern the Index API already accepts for contract ids. */
export const CONTRACT_NAME_REGEX: RegExp = /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/;

export function validateStacksAddress(address: string): boolean {
	try {
		c32addressDecode(address);
		return true;
	} catch {
		return false;
	}
}

/** Alias for validateStacksAddress — matches future.md naming. */
export const isValidAddress: (address: string) => boolean =
	validateStacksAddress;

/** Parse a principal into its parts, or null when malformed. The single
 *  definition of "valid principal" for this package: exactly one optional
 *  `.name` segment (never two), a c32-decodable address, and a contract name
 *  matching the Clarity grammar. */
export function parsePrincipal(
	value: string,
): { address: string; contractName?: string } | null {
	const parts = value.split(".");
	if (parts.length > 2) return null;
	const [address, contractName] = parts as [string, string | undefined];
	if (!validateStacksAddress(address)) return null;
	if (contractName === undefined) return { address };
	if (!CONTRACT_NAME_REGEX.test(contractName)) return null;
	return { address, contractName };
}

/** Split `address.name` into its parts. Throws on anything `parsePrincipal`
 *  rejects, and on a bare address with no contract name. */
export function parseContractId(contractId: string): [string, string] {
	const parsed = parsePrincipal(contractId);
	if (!parsed?.contractName)
		throw new Error(`Invalid contract identifier: ${contractId}`);
	return [parsed.address, parsed.contractName];
}

export function isClarityName(name: string): boolean {
	const regex = /^[a-zA-Z]([a-zA-Z0-9]|[-_!?+<>=/*])*$|^[-+=/*]$|^[<>]=?$/;
	return regex.test(name) && name.length < 128;
}

/**
 * Compare two Stacks addresses for equality (case-insensitive, version-aware).
 * Throws if either address is invalid.
 */
export function isAddressEqual(a: string, b: string): boolean {
	const [versionA, hashA] = c32addressDecode(a);
	const [versionB, hashB] = c32addressDecode(b);
	return versionA === versionB && hashA.toLowerCase() === hashB.toLowerCase();
}

/** Extract the version byte from a Stacks address (22, 20, 26, or 21). */
export function addressToVersion(address: string): number {
	return c32addressDecode(address)[0];
}

/**
 * Build a contract address from deployer + contract name.
 * Validates both parts; returns `deployer.contractName`.
 */
export function getContractAddress(
	deployer: string,
	contractName: string,
): string {
	if (!validateStacksAddress(deployer)) {
		throw new Error(`Invalid deployer address: ${deployer}`);
	}
	if (!isClarityName(contractName)) {
		throw new Error(`Invalid contract name: ${contractName}`);
	}
	return `${deployer}.${contractName}`;
}
