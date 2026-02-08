import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "../../accounts/privateKeyToAccount.ts";
import { buildTokenTransfer } from "../build.ts";
import {
  signTransaction,
  signTransactionWithAccount,
  signBegin,
  getOriginSigHash,
  signSponsor,
  signSponsorWithAccount,
} from "../signer.ts";
import { serializeTransaction } from "../wire/serialize.ts";
import { deserializeTransaction } from "../wire/deserialize.ts";
import { createSingleSigSpendingCondition } from "../authorization.ts";
import { AuthType, type SponsoredAuthorization, type SingleSigSpendingCondition } from "../types.ts";
import { bytesToHex } from "../../utils/encoding.ts";

// Deterministic test keys
const ORIGIN_KEY = "edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01";
const SPONSOR_KEY = "9888882b59abc471d140e5e0bb9c9109ae1ccf0a23b18fe3d20e3b5e12fb02e2";

const originAccount = privateKeyToAccount(ORIGIN_KEY);
const sponsorAccount = privateKeyToAccount(SPONSOR_KEY);

describe("sponsored transactions", () => {
  test("buildTokenTransfer with sponsored: true creates sponsored auth", () => {
    const tx = buildTokenTransfer({
      recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      amount: 1000n,
      fee: 200n,
      nonce: 0n,
      publicKey: originAccount.publicKey,
      sponsored: true,
    });

    expect(tx.auth.authType).toBe(AuthType.Sponsored);
    expect((tx.auth as SponsoredAuthorization).sponsorSpendingCondition).toBeDefined();
  });

  test("buildTokenTransfer without sponsored creates standard auth", () => {
    const tx = buildTokenTransfer({
      recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      amount: 1000n,
      fee: 200n,
      nonce: 0n,
      publicKey: originAccount.publicKey,
    });

    expect(tx.auth.authType).toBe(AuthType.Standard);
  });

  test("origin signs with AuthType.Standard even for sponsored tx", () => {
    const tx = buildTokenTransfer({
      recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      amount: 1000n,
      fee: 200n,
      nonce: 0n,
      publicKey: originAccount.publicKey,
      sponsored: true,
    });

    // Sign as origin — should not throw
    const signed = signTransaction(tx, ORIGIN_KEY);
    const condition = signed.auth.spendingCondition as SingleSigSpendingCondition;

    // Signature should be non-empty (not all zeros)
    expect(condition.signature).not.toBe("00".repeat(65));
    // Auth type remains sponsored
    expect(signed.auth.authType).toBe(AuthType.Sponsored);
  });

  test("signTransaction + signSponsor full flow with private keys", () => {
    const tx = buildTokenTransfer({
      recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      amount: 1000n,
      fee: 200n,
      nonce: 0n,
      publicKey: originAccount.publicKey,
      sponsored: true,
    });

    // Step 1: origin signs
    const originSigned = signTransaction(tx, ORIGIN_KEY);

    // Step 2: set sponsor spending condition
    const sponsorCondition = createSingleSigSpendingCondition(
      sponsorAccount.publicKey,
      5n, // sponsor nonce
      500n // sponsor fee
    );
    const withSponsor = {
      ...originSigned,
      auth: {
        ...(originSigned.auth as SponsoredAuthorization),
        sponsorSpendingCondition: sponsorCondition,
      },
    };

    // Step 3: sponsor signs
    const fullySigned = signSponsor(withSponsor, SPONSOR_KEY);

    // Verify both signatures are set
    const originCond = fullySigned.auth.spendingCondition as SingleSigSpendingCondition;
    const sponsorCond = (fullySigned.auth as SponsoredAuthorization).sponsorSpendingCondition as SingleSigSpendingCondition;
    expect(originCond.signature).not.toBe("00".repeat(65));
    expect(sponsorCond.signature).not.toBe("00".repeat(65));
  });

  test("signTransactionWithAccount + signSponsorWithAccount flow", async () => {
    const tx = buildTokenTransfer({
      recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      amount: 1000n,
      fee: 200n,
      nonce: 0n,
      publicKey: originAccount.publicKey,
      sponsored: true,
    });

    // Origin signs with account
    const originSigned = await signTransactionWithAccount(tx, originAccount);

    // Set sponsor condition
    const sponsorCondition = createSingleSigSpendingCondition(
      sponsorAccount.publicKey,
      5n,
      500n
    );
    const withSponsor = {
      ...originSigned,
      auth: {
        ...(originSigned.auth as SponsoredAuthorization),
        sponsorSpendingCondition: sponsorCondition,
      },
    };

    // Sponsor signs with account
    const fullySigned = await signSponsorWithAccount(withSponsor, sponsorAccount);

    const sponsorCond = (fullySigned.auth as SponsoredAuthorization).sponsorSpendingCondition as SingleSigSpendingCondition;
    expect(sponsorCond.signature).not.toBe("00".repeat(65));
  });

  test("serialization roundtrip preserves sponsored tx", () => {
    const tx = buildTokenTransfer({
      recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      amount: 1000n,
      fee: 200n,
      nonce: 0n,
      publicKey: originAccount.publicKey,
      sponsored: true,
    });

    const originSigned = signTransaction(tx, ORIGIN_KEY);

    const sponsorCondition = createSingleSigSpendingCondition(
      sponsorAccount.publicKey,
      5n,
      500n
    );
    const withSponsor = {
      ...originSigned,
      auth: {
        ...(originSigned.auth as SponsoredAuthorization),
        sponsorSpendingCondition: sponsorCondition,
      },
    };
    const fullySigned = signSponsor(withSponsor, SPONSOR_KEY);

    // Serialize and deserialize
    const bytes = serializeTransaction(fullySigned);
    const hex = bytesToHex(bytes);
    const deserialized = deserializeTransaction(hex);

    // Auth type preserved
    expect(deserialized.auth.authType).toBe(AuthType.Sponsored);

    // Origin signature preserved
    const origCond = deserialized.auth.spendingCondition as SingleSigSpendingCondition;
    const origCondExpected = fullySigned.auth.spendingCondition as SingleSigSpendingCondition;
    expect(origCond.signature).toBe(origCondExpected.signature);

    // Sponsor signature preserved
    const sponsCond = (deserialized.auth as SponsoredAuthorization).sponsorSpendingCondition as SingleSigSpendingCondition;
    const sponsCondExpected = (fullySigned.auth as SponsoredAuthorization).sponsorSpendingCondition as SingleSigSpendingCondition;
    expect(sponsCond.signature).toBe(sponsCondExpected.signature);
  });

  test("private key signing matches account signing for origin", async () => {
    const tx = buildTokenTransfer({
      recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      amount: 1000n,
      fee: 200n,
      nonce: 0n,
      publicKey: originAccount.publicKey,
      sponsored: true,
    });

    const signedWithKey = signTransaction(tx, ORIGIN_KEY);
    const signedWithAccount = await signTransactionWithAccount(tx, originAccount);

    const keySig = (signedWithKey.auth.spendingCondition as SingleSigSpendingCondition).signature;
    const accountSig = (signedWithAccount.auth.spendingCondition as SingleSigSpendingCondition).signature;
    expect(keySig).toBe(accountSig);
  });

  test("private key signing matches account signing for sponsor", async () => {
    const tx = buildTokenTransfer({
      recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      amount: 1000n,
      fee: 200n,
      nonce: 0n,
      publicKey: originAccount.publicKey,
      sponsored: true,
    });

    const originSigned = signTransaction(tx, ORIGIN_KEY);
    const sponsorCondition = createSingleSigSpendingCondition(
      sponsorAccount.publicKey,
      5n,
      500n
    );
    const withSponsor = {
      ...originSigned,
      auth: {
        ...(originSigned.auth as SponsoredAuthorization),
        sponsorSpendingCondition: sponsorCondition,
      },
    };

    const signedWithKey = signSponsor(withSponsor, SPONSOR_KEY);
    const signedWithAccount = await signSponsorWithAccount(withSponsor, sponsorAccount);

    const keySig = ((signedWithKey.auth as SponsoredAuthorization).sponsorSpendingCondition as SingleSigSpendingCondition).signature;
    const accountSig = ((signedWithAccount.auth as SponsoredAuthorization).sponsorSpendingCondition as SingleSigSpendingCondition).signature;
    expect(keySig).toBe(accountSig);
  });

  test("signSponsor throws for non-sponsored tx", () => {
    const tx = buildTokenTransfer({
      recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      amount: 1000n,
      fee: 200n,
      nonce: 0n,
      publicKey: originAccount.publicKey,
    });

    const signed = signTransaction(tx, ORIGIN_KEY);
    expect(() => signSponsor(signed, SPONSOR_KEY)).toThrow("must be sponsored");
  });

  test("getOriginSigHash is deterministic", () => {
    const tx = buildTokenTransfer({
      recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      amount: 1000n,
      fee: 200n,
      nonce: 0n,
      publicKey: originAccount.publicKey,
      sponsored: true,
    });

    const signed = signTransaction(tx, ORIGIN_KEY);
    const hash1 = getOriginSigHash(signed);
    const hash2 = getOriginSigHash(signed);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // 32 bytes hex
  });
});
