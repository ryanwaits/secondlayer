import { bytesToHex, hexToBytes } from "../utils/encoding.ts";
import { txidFromBytes } from "../utils/hash.ts";
import {
  intoInitialSighashAuth,
  nextSignature,
  sigHashPreSign,
  sigHashPostSign,
  createSingleSigSpendingCondition,
} from "./authorization.ts";
import { serializeTransaction } from "./wire/serialize.ts";
import {
  AuthType,
  PubKeyEncoding,
  RECOVERABLE_ECDSA_SIG_LENGTH_BYTES,
  type StacksTransaction,
  type SingleSigSpendingCondition,
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

  const { nextSig, nextSigHash } = nextSignature(
    sigHash,
    tx.auth.authType,
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

  const sigHashPre = sigHashPreSign(
    sigHash,
    tx.auth.authType,
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
