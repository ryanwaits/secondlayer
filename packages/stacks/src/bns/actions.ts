import type { Client } from "../clients/types.ts";
import { getContract } from "../actions/getContract.ts";
import { BNS_ABI } from "./abi.ts";
import { ZONEFILE_RESOLVER_ABI } from "./zonefile-abi.ts";
import { BNS_CONTRACTS, ZONEFILE_RESOLVER_CONTRACTS } from "./constants.ts";
import {
  parseFQN,
  validateFQN,
  formatFQN,
  generateSalt,
  hashPreorder,
} from "./utils.ts";
import type {
  ClaimFastParams,
  TransferParams,
  SetPrimaryParams,
  PreorderParams,
  RegisterParams,
  UpdateZonefileParams,
} from "./types.ts";
import { Pc } from "../postconditions/index.ts";
import { Cl } from "../clarity/index.ts";

function getBnsContract(client: Client) {
  if (!client.chain) {
    throw new Error("Client must have a chain configured");
  }
  const network = client.chain.network;
  const contract =
    network === "mainnet" ? BNS_CONTRACTS.mainnet : BNS_CONTRACTS.testnet;

  return getContract({
    client,
    address: contract.address,
    name: contract.name,
    abi: BNS_ABI,
  });
}

function getZonefileContract(client: Client) {
  if (!client.chain) {
    throw new Error("Client must have a chain configured");
  }
  const network = client.chain.network;
  const contract =
    network === "mainnet"
      ? ZONEFILE_RESOLVER_CONTRACTS.mainnet
      : ZONEFILE_RESOLVER_CONTRACTS.testnet;

  return getContract({
    client,
    address: contract.address,
    name: contract.name,
    abi: ZONEFILE_RESOLVER_ABI,
  });
}

function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Resolve a BNS name to its owner address.
 * @example
 * const owner = await resolveName(client, "alice.btc");
 */
export async function resolveName(
  client: Client,
  nameOrFQN: string
): Promise<string | null> {
  if (!validateFQN(nameOrFQN)) {
    throw new Error(`Invalid name format: ${nameOrFQN}`);
  }

  const { name, namespace } = parseFQN(nameOrFQN);
  const bns = getBnsContract(client);

  const owner = (await bns.read["get-owner-name"]({
    name: stringToBytes(name),
    namespace: stringToBytes(namespace),
  })) as string | null;

  return owner;
}

/**
 * Get the primary name for an address.
 * @example
 * const primary = await getPrimaryName(client, "SP2J6...");
 */
export async function getPrimaryName(
  client: Client,
  address: string
): Promise<string | null> {
  const bns = getBnsContract(client);

  const result = (await bns.read["get-primary"]({
    owner: address,
  })) as { name: Uint8Array; namespace: Uint8Array } | null;

  if (result === null) return null;

  const name = new TextDecoder().decode(result.name);
  const namespace = new TextDecoder().decode(result.namespace);

  return formatFQN(name, namespace);
}

/**
 * Check if a name is available for registration.
 * @example
 * const available = await canRegister(client, "bob.btc");
 */
export async function canRegister(
  client: Client,
  nameOrFQN: string
): Promise<boolean> {
  if (!validateFQN(nameOrFQN)) {
    throw new Error(`Invalid name format: ${nameOrFQN}`);
  }

  const { name, namespace } = parseFQN(nameOrFQN);
  const bns = getBnsContract(client);

  // No can-register-name function — use can-resolve-name instead.
  // If it resolves, the name is taken. If it errors, it's available.
  try {
    await bns.read["can-resolve-name"]({
      namespace: stringToBytes(namespace),
      name: stringToBytes(name),
    });
    return false; // resolved = taken
  } catch {
    return true; // error = available
  }
}

/**
 * Get the price to register a name in microSTX.
 * @example
 * const price = await getNamePrice(client, "bob.btc");
 */
export async function getNamePrice(
  client: Client,
  nameOrFQN: string
): Promise<bigint> {
  if (!validateFQN(nameOrFQN)) {
    throw new Error(`Invalid name format: ${nameOrFQN}`);
  }

  const { name, namespace } = parseFQN(nameOrFQN);
  const bns = getBnsContract(client);

  // get-name-price returns a nested response: (ok (ok uint))
  const result = (await bns.read["get-name-price"]({
    namespace: stringToBytes(namespace),
    name: stringToBytes(name),
  })) as { ok: bigint } | { err: bigint };

  if ("ok" in result) return result.ok;
  throw new Error(`Failed to get name price for ${nameOrFQN}`);
}

/**
 * Get the NFT token ID for a name.
 * @example
 * const id = await getNameId(client, "alice.btc");
 */
export async function getNameId(
  client: Client,
  nameOrFQN: string
): Promise<bigint | null> {
  if (!validateFQN(nameOrFQN)) {
    throw new Error(`Invalid name format: ${nameOrFQN}`);
  }

  const { name, namespace } = parseFQN(nameOrFQN);
  const bns = getBnsContract(client);

  return (await bns.read["get-id-from-bns"]({
    name: stringToBytes(name),
    namespace: stringToBytes(namespace),
  })) as bigint | null;
}

/**
 * Preorder a name (step 1 of secure registration).
 * Commits to a name with a salted hash, preventing front-running.
 * Must wait 1 Bitcoin block (~10 min) before calling register().
 *
 * @example
 * const { txid, salt } = await preorder(client, {
 *   name: "bob.btc",
 * });
 * // Save salt! You'll need it for register()
 * // Wait ~10 minutes (1 Bitcoin block)
 * await register(client, { name: "bob.btc", salt });
 */
export async function preorder(
  client: Client,
  params: PreorderParams
): Promise<{ txid: string; salt: Uint8Array }> {
  const { name: nameInput, namespace: namespaceInput, salt: providedSalt } = params;
  const fqn = namespaceInput ? `${nameInput}.${namespaceInput}` : nameInput;

  if (!validateFQN(fqn)) {
    throw new Error(`Invalid name format: ${fqn}`);
  }

  const { name, namespace } = parseFQN(fqn);

  // Check availability
  const available = await canRegister(client, fqn);
  if (!available) {
    throw new Error(`Name ${fqn} is not available for registration`);
  }

  // Get price
  const price = await getNamePrice(client, fqn);

  // Generate or use provided salt
  const salt = providedSalt ?? generateSalt();

  // Calculate hash commitment
  const hashedSaltedFqn = hashPreorder(name, namespace, salt);

  const bns = getBnsContract(client);

  const txid = await bns.call["name-preorder"](
    {
      hashedSaltedFqn,
      stxToBurn: price,
    },
    {
      postConditions: [Pc.principal(client.account!.address).willSendLte(price).ustx()],
    }
  );

  return { txid, salt };
}

/**
 * Register a name (step 2 of secure registration).
 * Reveals the name after preorder. Must wait 1 Bitcoin block after preorder.
 *
 * @example
 * const { txid } = await register(client, {
 *   name: "bob.btc",
 *   salt, // from preorder()
 * });
 */
export async function register(
  client: Client,
  params: RegisterParams
): Promise<string> {
  const { name: nameInput, namespace: namespaceInput, salt } = params;
  const fqn = namespaceInput ? `${nameInput}.${namespaceInput}` : nameInput;

  if (!validateFQN(fqn)) {
    throw new Error(`Invalid name format: ${fqn}`);
  }

  const { name, namespace } = parseFQN(fqn);

  const bns = getBnsContract(client);

  return bns.call["name-register"]({
    name: stringToBytes(name),
    namespace: stringToBytes(namespace),
    salt,
  });
}

/**
 * Claim a name instantly (fast but snipeable).
 * Burns STX to register the name immediately.
 * @example
 * const txid = await claimFast(client, {
 *   name: "bob.btc",
 *   recipient: account.address,
 * });
 */
export async function claimFast(
  client: Client,
  params: ClaimFastParams
): Promise<string> {
  const { name: nameInput, namespace: namespaceInput, recipient } = params;
  const fqn = namespaceInput ? `${nameInput}.${namespaceInput}` : nameInput;

  if (!validateFQN(fqn)) {
    throw new Error(`Invalid name format: ${fqn}`);
  }

  const { name, namespace } = parseFQN(fqn);

  // Check availability
  const available = await canRegister(client, fqn);
  if (!available) {
    throw new Error(`Name ${fqn} is not available for registration`);
  }

  // Get price
  const price = await getNamePrice(client, fqn);

  const bns = getBnsContract(client);

  return bns.call["name-claim-fast"](
    {
      name: stringToBytes(name),
      namespace: stringToBytes(namespace),
      sendTo: recipient,
    },
    {
      postConditions: [Pc.principal(recipient).willSendLte(price).ustx()],
    }
  );
}

/**
 * Transfer a name to a new owner.
 * @example
 * const txid = await transfer(client, {
 *   name: "alice.btc",
 *   recipient: "SP3FBR...",
 * });
 */
export async function transfer(
  client: Client,
  params: TransferParams
): Promise<string> {
  const { name: nameInput, namespace: namespaceInput, recipient } = params;
  const fqn = namespaceInput ? `${nameInput}.${namespaceInput}` : nameInput;

  if (!validateFQN(fqn)) {
    throw new Error(`Invalid name format: ${fqn}`);
  }

  const id = await getNameId(client, fqn);
  if (id === null) {
    throw new Error(`Name ${fqn} does not exist`);
  }

  const currentOwner = await resolveName(client, fqn);
  if (!currentOwner) {
    throw new Error(`Cannot determine owner of ${fqn}`);
  }

  const bns = getBnsContract(client);
  if (!client.chain) {
    throw new Error("Client must have a chain configured");
  }
  const network = client.chain.network;
  const contract =
    network === "mainnet" ? BNS_CONTRACTS.mainnet : BNS_CONTRACTS.testnet;

  return bns.call.transfer(
    {
      id,
      owner: currentOwner,
      recipient,
    },
    {
      postConditions: [
        Pc.principal(currentOwner)
          .willSendAsset()
          .nft(`${contract.address}.${contract.name}::BNS-V2`, Cl.uint(id)),
      ],
    }
  );
}

/**
 * Set a name as your primary name.
 * @example
 * const txid = await setPrimary(client, {
 *   name: "alice.btc",
 * });
 */
export async function setPrimary(
  client: Client,
  params: SetPrimaryParams
): Promise<string> {
  const { name: nameInput, namespace: namespaceInput } = params;
  const fqn = namespaceInput ? `${nameInput}.${namespaceInput}` : nameInput;

  if (!validateFQN(fqn)) {
    throw new Error(`Invalid name format: ${fqn}`);
  }

  const id = await getNameId(client, fqn);
  if (id === null) {
    throw new Error(`Name ${fqn} does not exist`);
  }

  const bns = getBnsContract(client);

  return bns.call["set-primary-name"]({ primaryNameId: id });
}

/**
 * Get the zonefile for a name.
 * Zonefiles contain DNS-like records (up to 8192 bytes).
 *
 * @example
 * const zonefile = await getZonefile(client, "alice.btc");
 * if (zonefile) {
 *   console.log(new TextDecoder().decode(zonefile));
 * }
 */
export async function getZonefile(
  client: Client,
  nameOrFQN: string
): Promise<Uint8Array | null> {
  if (!validateFQN(nameOrFQN)) {
    throw new Error(`Invalid name format: ${nameOrFQN}`);
  }

  const { name, namespace } = parseFQN(nameOrFQN);
  const zonefile = getZonefileContract(client);

  try {
    const result = (await zonefile.read["resolve-name"]({
      name: stringToBytes(name),
      namespace: stringToBytes(namespace),
    })) as Uint8Array | null;

    return result;
  } catch {
    // Contract returns (err 101) when no zonefile is set
    return null;
  }
}

/**
 * Update or clear the zonefile for a name.
 * Only the name owner can update the zonefile.
 *
 * @example
 * // Update zonefile
 * await updateZonefile(client, {
 *   name: "alice.btc",
 *   zonefile: "$ORIGIN alice.btc\n$TTL 3600\n...",
 * });
 *
 * // Clear zonefile
 * await updateZonefile(client, {
 *   name: "alice.btc",
 *   zonefile: null,
 * });
 */
export async function updateZonefile(
  client: Client,
  params: UpdateZonefileParams
): Promise<string> {
  const { name: nameInput, namespace: namespaceInput, zonefile } = params;
  const fqn = namespaceInput ? `${nameInput}.${namespaceInput}` : nameInput;

  if (!validateFQN(fqn)) {
    throw new Error(`Invalid name format: ${fqn}`);
  }

  const { name, namespace } = parseFQN(fqn);

  // Verify ownership
  const currentOwner = await resolveName(client, fqn);
  if (!currentOwner) {
    throw new Error(`Name ${fqn} does not exist`);
  }

  const zonefileContract = getZonefileContract(client);

  // Convert zonefile to Uint8Array or null
  let zonefileBytes: Uint8Array | null = null;
  if (zonefile !== null) {
    zonefileBytes =
      typeof zonefile === "string"
        ? new TextEncoder().encode(zonefile)
        : zonefile;

    if (zonefileBytes.length > 8192) {
      throw new Error(
        `Zonefile too large: ${zonefileBytes.length} bytes (max 8192)`
      );
    }
  }

  return zonefileContract.call["update-zonefile"]({
    name: stringToBytes(name),
    namespace: stringToBytes(namespace),
    newZonefile: zonefileBytes,
  });
}

/**
 * Revoke (clear) the zonefile for a name.
 * Alias for updateZonefile with zonefile: null.
 *
 * @example
 * await revokeZonefile(client, "alice.btc");
 */
export async function revokeZonefile(
  client: Client,
  nameOrFQN: string
): Promise<string> {
  if (!validateFQN(nameOrFQN)) {
    throw new Error(`Invalid name format: ${nameOrFQN}`);
  }

  const { name, namespace } = parseFQN(nameOrFQN);
  const zonefileContract = getZonefileContract(client);

  return zonefileContract.call["revoke-name"]({
    name: stringToBytes(name),
    namespace: stringToBytes(namespace),
  });
}
