/**
 * Parse a fully-qualified contract ID ("address.contractName") into its parts.
 * Throws if the input doesn't contain a dot separator.
 */
export function parseContractId(contractId: string): {
  address: string;
  contractName: string;
} {
  const dotIndex = contractId.indexOf(".");
  if (dotIndex === -1) {
    throw new Error(
      `Invalid contract ID: "${contractId}" (expected "address.contractName")`
    );
  }
  return {
    address: contractId.slice(0, dotIndex),
    contractName: contractId.slice(dotIndex + 1),
  };
}
