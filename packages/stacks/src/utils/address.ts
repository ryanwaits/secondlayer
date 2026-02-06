import { c32address, c32addressDecode } from "c32check";

export { c32address, c32addressDecode };

export function validateStacksAddress(address: string): boolean {
  try {
    c32addressDecode(address);
    return true;
  } catch {
    return false;
  }
}

/** Alias for validateStacksAddress — matches future.md naming. */
export const isValidAddress = validateStacksAddress;

export function parseContractId(contractId: string): [string, string] {
  const [address, name] = contractId.split(".");
  if (!address || !name)
    throw new Error(`Invalid contract identifier: ${contractId}`);
  return [address, name];
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
export function getContractAddress(deployer: string, contractName: string): string {
  if (!validateStacksAddress(deployer)) {
    throw new Error(`Invalid deployer address: ${deployer}`);
  }
  if (!isClarityName(contractName)) {
    throw new Error(`Invalid contract name: ${contractName}`);
  }
  return `${deployer}.${contractName}`;
}
