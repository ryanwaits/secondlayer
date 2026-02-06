import type { Client } from "../../clients/types.ts";
import type { ClarityValue } from "../../clarity/types.ts";
import { Cl } from "../../clarity/values.ts";
import { serializeCVBytes } from "../../clarity/serialize.ts";
import { concatBytes, bytesToHex } from "../../utils/encoding.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { isProviderAccount } from "./utils.ts";

export type SignMessageParams = {
  message: string | ClarityValue;
  domain?: {
    name: string;
    version: string;
    chainId: number;
  };
};

const SIP018_PREFIX = new Uint8Array([0x53, 0x49, 0x50, 0x30, 0x31, 0x38]); // "SIP018"

/** Sign a structured message per SIP-018 */
export async function signMessage(
  client: Client,
  params: SignMessageParams
): Promise<string> {
  const account = client.account;
  if (!account) throw new Error("Account required");

  // Provider: delegate to wallet
  if (isProviderAccount(account)) {
    const method = params.domain
      ? "stx_signStructuredMessage"
      : "stx_signMessage";
    const result = await account.provider.request(method, {
      message: params.message,
      domain: params.domain,
    });
    return result.signature;
  }

  // Local/Custom: sign locally
  const cv =
    typeof params.message === "string"
      ? Cl.stringAscii(params.message)
      : params.message;

  const serializedMsg = serializeCVBytes(cv);

  let hash: Uint8Array;

  if (params.domain) {
    const domainCV = Cl.tuple({
      name: Cl.stringAscii(params.domain.name),
      version: Cl.stringAscii(params.domain.version),
      "chain-id": Cl.uint(params.domain.chainId),
    });
    const serializedDomain = serializeCVBytes(domainCV);
    hash = sha256(concatBytes(SIP018_PREFIX, serializedDomain, serializedMsg));
  } else {
    hash = sha256(serializedMsg);
  }

  const sigBytes = await account.sign(hash);
  return bytesToHex(sigBytes);
}
