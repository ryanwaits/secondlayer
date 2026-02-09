import type { Client } from "../clients/types.ts";
import {
  resolveName,
  getPrimaryName,
  canRegister,
  getNamePrice,
  getNameId,
  preorder,
  register,
  claimFast,
  transfer,
  setPrimary,
  getZonefile,
  updateZonefile,
  revokeZonefile,
} from "./actions.ts";
import type {
  ClaimFastParams,
  TransferParams,
  SetPrimaryParams,
  PreorderParams,
  RegisterParams,
  UpdateZonefileParams,
} from "./types.ts";

export type {
  ClaimFastParams,
  TransferParams,
  SetPrimaryParams,
  PreorderParams,
  RegisterParams,
  UpdateZonefileParams,
};
export { BNS_CONTRACTS, ZONEFILE_RESOLVER_CONTRACTS } from "./constants.ts";
export {
  parseFQN,
  formatFQN,
  validateName,
  validateNamespace,
  validateFQN,
  generateSalt,
  hashPreorder,
} from "./utils.ts";

/**
 * BNS v2 extension for Stacks client.
 * Provides name resolution, registration, and management.
 *
 * @example
 * import { createWalletClient, http, mainnet } from "stacks";
 * import { bns } from "stacks/bns";
 * import { privateKeyToAccount } from "stacks/accounts";
 *
 * const account = privateKeyToAccount("0x...");
 * const client = createWalletClient({
 *   account,
 *   chain: mainnet,
 *   transport: http(),
 * }).extend(bns());
 *
 * // Resolve names
 * const owner = await client.bns.resolveName("alice.btc");
 *
 * // Register names
 * const txid = await client.bns.claimFast({
 *   name: "bob.btc",
 *   recipient: account.address,
 * });
 *
 * // Transfer names
 * await client.bns.transfer({
 *   name: "alice.btc",
 *   recipient: "SP3FBR...",
 * });
 */
export function bns() {
  return (client: Client) => ({
    bns: {
      /**
       * Resolve a BNS name to its owner address.
       * @param name - Fully qualified name (e.g., "alice.btc" or "alice")
       * @returns Owner address or null if name doesn't exist
       */
      resolveName: (name: string) => resolveName(client, name),

      /**
       * Get the primary name for an address.
       * @param address - Stacks address
       * @returns Primary name or null if no primary set
       */
      getPrimaryName: (address: string) => getPrimaryName(client, address),

      /**
       * Check if a name is available for registration.
       * @param name - Fully qualified name to check
       * @returns True if available, false otherwise
       */
      canRegister: (name: string) => canRegister(client, name),

      /**
       * Get the price to register a name in microSTX.
       * @param name - Fully qualified name
       * @returns Price in microSTX
       */
      getNamePrice: (name: string) => getNamePrice(client, name),

      /**
       * Get the NFT token ID for a name.
       * @param name - Fully qualified name
       * @returns Token ID or null if name doesn't exist
       */
      getNameId: (name: string) => getNameId(client, name),

      /**
       * Preorder a name (step 1 of secure registration).
       * Commits to a name with a salted hash, preventing front-running.
       * Must wait 1 Bitcoin block (~10 min) before calling register().
       * Requires wallet client with account.
       * @param params - Preorder parameters
       * @returns Transaction ID and salt (save salt for register step!)
       */
      preorder: (params: PreorderParams) => preorder(client, params),

      /**
       * Register a name (step 2 of secure registration).
       * Reveals the name after preorder. Must wait 1 Bitcoin block after preorder.
       * Requires wallet client with account.
       * @param params - Register parameters (must include salt from preorder)
       * @returns Transaction ID
       */
      register: (params: RegisterParams) => register(client, params),

      /**
       * Claim a name instantly (fast but snipeable).
       * Burns STX to register the name immediately.
       * Requires wallet client with account.
       * @param params - Registration parameters
       * @returns Transaction ID
       */
      claimFast: (params: ClaimFastParams) => claimFast(client, params),

      /**
       * Transfer a name to a new owner.
       * Requires wallet client with account.
       * @param params - Transfer parameters
       * @returns Transaction ID
       */
      transfer: (params: TransferParams) => transfer(client, params),

      /**
       * Set a name as your primary name.
       * Requires wallet client with account.
       * @param params - Primary name parameters
       * @returns Transaction ID
       */
      setPrimary: (params: SetPrimaryParams) => setPrimary(client, params),

      /**
       * Get the zonefile for a name.
       * Zonefiles contain DNS-like records (up to 8192 bytes).
       * @param name - Fully qualified name
       * @returns Zonefile bytes or null if not set
       */
      getZonefile: (name: string) => getZonefile(client, name),

      /**
       * Update or clear the zonefile for a name.
       * Only the name owner can update the zonefile.
       * Requires wallet client with account.
       * @param params - Zonefile update parameters
       * @returns Transaction ID
       */
      updateZonefile: (params: UpdateZonefileParams) =>
        updateZonefile(client, params),

      /**
       * Revoke (clear) the zonefile for a name.
       * Requires wallet client with account.
       * @param name - Fully qualified name
       * @returns Transaction ID
       */
      revokeZonefile: (name: string) => revokeZonefile(client, name),
    },
  });
}
