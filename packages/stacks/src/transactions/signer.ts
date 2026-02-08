import { bytesToHex, hexToBytes } from "../utils/encoding.ts";
import { txidFromBytes } from "../utils/hash.ts";
import {
  intoInitialSighashAuth,
  nextSignature,
  sigHashPreSign,
  sigHashPostSign,
  createSingleSigSpendingCondition,
} from "./authorization.ts";
import { replayMultiSigSigHash } from "./multisig.ts";
import { serializeTransaction } from "./wire/serialize.ts";
import {
  AuthType,
  PubKeyEncoding,
  RECOVERABLE_ECDSA_SIG_LENGTH_BYTES,
  type StacksTransaction,
  type SingleSigSpendingCondition,
  type MultiSigSpendingCondition,
  type SponsoredAuthorization,
} from "./types.ts";
import type { LocalAccount, CustomAccount } from "../accounts/types.ts";

function txid(tx: StacksTransaction): string {
  return txidFromBytes(serializeTransaction(tx));
}

/** Compute the initial sighash for a transaction */
export function signBegin(tx: StacksTransaction): string {
  const cleared: StacksTransaction = {
    ...tx,
    auth: intoInitialSighashAuth(tx.auth),
  };
  return txid(cleared);
}

/** Sign a single-sig transaction with a private key, returning the signed transaction */
export function signTransaction(
  tx: StacksTransaction,
  privateKey: string
): StacksTransaction {
  const sigHash = signBegin(tx);
  const condition = tx.auth.spendingCondition as SingleSigSpendingCondition;

  // Origin always signs with AuthType.Standard (even for sponsored txs)
  const { nextSig, nextSigHash } = nextSignature(
    sigHash,
    AuthType.Standard,
    condition.fee,
    condition.nonce,
    privateKey
  );

  return {
    ...tx,
    auth: {
      ...tx.auth,
      spendingCondition: {
        ...condition,
        signature: nextSig,
      },
    },
  };
}

/** Sign a single-sig transaction using an account (LocalAccount or CustomAccount) */
export async function signTransactionWithAccount(
  tx: StacksTransaction,
  account: LocalAccount | CustomAccount
): Promise<StacksTransaction> {
  const sigHash = signBegin(tx);
  const condition = tx.auth.spendingCondition as SingleSigSpendingCondition;

  // Origin always signs with AuthType.Standard (even for sponsored txs)
  const sigHashPre = sigHashPreSign(
    sigHash,
    AuthType.Standard,
    condition.fee,
    condition.nonce
  );

  // account.sign returns 65-byte VRS (recovery + r + s)
  const sigBytes = await account.sign(hexToBytes(sigHashPre));
  const nextSig = bytesToHex(sigBytes);

  const pubKeyBytes = hexToBytes(account.publicKey);
  const pubKeyEncoding =
    pubKeyBytes.length === 33
      ? PubKeyEncoding.Compressed
      : PubKeyEncoding.Uncompressed;

  return {
    ...tx,
    auth: {
      ...tx.auth,
      spendingCondition: {
        ...condition,
        signature: nextSig,
      },
    },
  };
}

/** Get the txid of a transaction */
export function getTransactionId(tx: StacksTransaction): string {
  return txid(tx);
}

/** Reconstruct the sighash after origin signing (needed for sponsor signing) */
export function getOriginSigHash(tx: StacksTransaction): string {
  const condition = tx.auth.spendingCondition;

  // Multi-sig: replay through all fields
  if ("fields" in condition) {
    return replayMultiSigSigHash(tx);
  }

  // Single-sig
  const initialSigHash = signBegin(tx);
  const sc = condition as SingleSigSpendingCondition;
  const preSign = sigHashPreSign(initialSigHash, AuthType.Standard, sc.fee, sc.nonce);
  return sigHashPostSign(preSign, sc.keyEncoding, sc.signature);
}

/** Sign a sponsored transaction as the sponsor with a private key */
export function signSponsor(tx: StacksTransaction, privateKey: string): StacksTransaction {
  if (tx.auth.authType !== AuthType.Sponsored) {
    throw new Error("Transaction must be sponsored");
  }
  const auth = tx.auth as SponsoredAuthorization;
  const sponsorCondition = auth.sponsorSpendingCondition as SingleSigSpendingCondition;
  const originSigHash = getOriginSigHash(tx);

  const { nextSig } = nextSignature(
    originSigHash,
    AuthType.Sponsored,
    sponsorCondition.fee,
    sponsorCondition.nonce,
    privateKey
  );

  return {
    ...tx,
    auth: {
      ...auth,
      sponsorSpendingCondition: {
        ...sponsorCondition,
        signature: nextSig,
      },
    },
  };
}

/** Sign a sponsored transaction as the sponsor using an account */
export async function signSponsorWithAccount(
  tx: StacksTransaction,
  account: LocalAccount | CustomAccount
): Promise<StacksTransaction> {
  if (tx.auth.authType !== AuthType.Sponsored) {
    throw new Error("Transaction must be sponsored");
  }
  const auth = tx.auth as SponsoredAuthorization;
  const sponsorCondition = auth.sponsorSpendingCondition as SingleSigSpendingCondition;
  const originSigHash = getOriginSigHash(tx);

  const sigHashPre = sigHashPreSign(
    originSigHash,
    AuthType.Sponsored,
    sponsorCondition.fee,
    sponsorCondition.nonce
  );

  const sigBytes = await account.sign(hexToBytes(sigHashPre));
  const nextSig = bytesToHex(sigBytes);

  return {
    ...tx,
    auth: {
      ...auth,
      sponsorSpendingCondition: {
        ...sponsorCondition,
        signature: nextSig,
      },
    },
  };
}
