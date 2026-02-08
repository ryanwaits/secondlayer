import { describe, expect, test } from "bun:test";
import { getPublicKey } from "@noble/secp256k1";
import { privateKeyToAccount } from "../../accounts/privateKeyToAccount.ts";
import { bytesToHex, hexToBytes } from "../../utils/encoding.ts";
import { buildTokenTransfer } from "../build.ts";
import { serializeTransaction } from "../wire/serialize.ts";
import { deserializeTransaction } from "../wire/deserialize.ts";
import {
  makeMultiSigAddress,
  createMultiSigSpendingCondition,
  signMultiSig,
  signMultiSigWithAccount,
  finalizeMultiSig,
  combineMultiSigSignatures,
  isNonSequential,
} from "../multisig.ts";
import { AddressHashMode } from "../types.ts";
import type { MultiSigSpendingCondition } from "../types.ts";
import { mainnet, testnet } from "../../chains/definitions.ts";

// 3 deterministic test keys
const KEY1 = "6d430bb91222b0a96b16a8b2631b82895f45e9a68e5b34fdf202dfb25b111de1";
const KEY2 = "b463f0df6c05d2f156393eee73f8016c5372caa0e9e29a901bb7571c8d8e0baf";
const KEY3 = "7c3315fcf49bb68aa4c1a9514e4b4f8f4c958630de8449093f04e9e68fd7c19e";

const pubkey1 = bytesToHex(getPublicKey(hexToBytes(KEY1), true));
const pubkey2 = bytesToHex(getPublicKey(hexToBytes(KEY2), true));
const pubkey3 = bytesToHex(getPublicKey(hexToBytes(KEY3), true));

const publicKeys = [pubkey1, pubkey2, pubkey3];

describe("multi-sig", () => {
  describe("makeMultiSigAddress", () => {
    test("produces valid mainnet address", () => {
      const addr = makeMultiSigAddress(publicKeys, 2, mainnet);
      // Mainnet multi-sig addresses start with SM
      expect(addr.startsWith("S")).toBe(true);
      expect(addr.length).toBeGreaterThan(30);
    });

    test("produces valid testnet address", () => {
      const addr = makeMultiSigAddress(publicKeys, 2, testnet);
      expect(addr.startsWith("S")).toBe(true);
    });

    test("deterministic — same keys same address", () => {
      const a = makeMultiSigAddress(publicKeys, 2);
      const b = makeMultiSigAddress(publicKeys, 2);
      expect(a).toBe(b);
    });

    test("different key order produces different address", () => {
      const a = makeMultiSigAddress([pubkey1, pubkey2, pubkey3], 2);
      const b = makeMultiSigAddress([pubkey3, pubkey2, pubkey1], 2);
      expect(a).not.toBe(b);
    });

    test("different required sigs produces different address", () => {
      const a = makeMultiSigAddress(publicKeys, 2);
      const b = makeMultiSigAddress(publicKeys, 3);
      expect(a).not.toBe(b);
    });

    test("throws for invalid signaturesRequired", () => {
      expect(() => makeMultiSigAddress(publicKeys, 0)).toThrow();
      expect(() => makeMultiSigAddress(publicKeys, 4)).toThrow();
    });
  });

  describe("createMultiSigSpendingCondition", () => {
    test("creates condition with empty fields", () => {
      const cond = createMultiSigSpendingCondition(publicKeys, 2, 0n, 200n);
      expect(cond.fields).toEqual([]);
      expect(cond.signaturesRequired).toBe(2);
      expect(cond.hashMode).toBe(0x01); // P2SH default
      expect(cond.nonce).toBe(0n);
      expect(cond.fee).toBe(200n);
    });
  });

  describe("signMultiSig", () => {
    test("2-of-3 signing flow", () => {
      const tx = buildTokenTransfer({
        recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        amount: 1000n,
        fee: 200n,
        nonce: 0n,
        publicKeys,
        signaturesRequired: 2,
      });

      // First signer (key1 at index 0)
      const partial = signMultiSig(tx, KEY1, publicKeys);
      const partialCond = partial.auth.spendingCondition as MultiSigSpendingCondition;
      // Should have 1 signature field
      expect(partialCond.fields.length).toBe(1);
      expect(partialCond.fields[0]!.type).toBe("signature");

      // Second signer (key2 at index 1) — should auto-finalize since 2 of 2 required
      const full = signMultiSig(partial, KEY2, publicKeys);
      const fullCond = full.auth.spendingCondition as MultiSigSpendingCondition;

      // Should have 3 fields total: sig, sig, pubkey (auto-finalized)
      expect(fullCond.fields.length).toBe(3);
      expect(fullCond.fields[0]!.type).toBe("signature");
      expect(fullCond.fields[1]!.type).toBe("signature");
      expect(fullCond.fields[2]!.type).toBe("publicKey");
    });

    test("non-sequential signing fills pubkey gaps", () => {
      const tx = buildTokenTransfer({
        recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        amount: 1000n,
        fee: 200n,
        nonce: 0n,
        publicKeys,
        signaturesRequired: 2,
      });

      // Sign with key1 (index 0) then key3 (index 2)
      const partial = signMultiSig(tx, KEY1, publicKeys);
      const full = signMultiSig(partial, KEY3, publicKeys);
      const cond = full.auth.spendingCondition as MultiSigSpendingCondition;

      // Should have: sig(key1), pubkey(key2), sig(key3) = 3 fields
      expect(cond.fields.length).toBe(3);
      expect(cond.fields[0]!.type).toBe("signature");
      expect(cond.fields[1]!.type).toBe("publicKey"); // gap filled
      expect(cond.fields[2]!.type).toBe("signature");
    });

    test("error: signing with non-member key", () => {
      const tx = buildTokenTransfer({
        recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        amount: 1000n,
        fee: 200n,
        nonce: 0n,
        publicKeys,
        signaturesRequired: 2,
      });

      const nonMemberKey = "a".repeat(64);
      expect(() => signMultiSig(tx, nonMemberKey, publicKeys)).toThrow(
        "does not correspond"
      );
    });
  });

  describe("signMultiSigWithAccount", () => {
    test("account signing matches private key signing", async () => {
      const account1 = privateKeyToAccount(KEY1);

      const tx = buildTokenTransfer({
        recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        amount: 1000n,
        fee: 200n,
        nonce: 0n,
        publicKeys,
        signaturesRequired: 2,
      });

      const withKey = signMultiSig(tx, KEY1, publicKeys);
      const withAccount = await signMultiSigWithAccount(tx, account1, publicKeys);

      const keyCond = withKey.auth.spendingCondition as MultiSigSpendingCondition;
      const acctCond = withAccount.auth.spendingCondition as MultiSigSpendingCondition;
      expect(keyCond.fields[0]!.data).toBe(acctCond.fields[0]!.data);
    });
  });

  describe("finalizeMultiSig", () => {
    test("fills remaining slots with pubkey fields", () => {
      const tx = buildTokenTransfer({
        recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        amount: 1000n,
        fee: 200n,
        nonce: 0n,
        publicKeys,
        signaturesRequired: 2,
      });

      // Only sign with key1 (not enough sigs for auto-finalize)
      let partial = signMultiSig(tx, KEY1, publicKeys);
      const partialCond = partial.auth.spendingCondition as MultiSigSpendingCondition;
      expect(partialCond.fields.length).toBe(1);

      // Manual finalize
      const finalized = finalizeMultiSig(partial, publicKeys);
      const finalCond = finalized.auth.spendingCondition as MultiSigSpendingCondition;
      expect(finalCond.fields.length).toBe(3);
      expect(finalCond.fields[1]!.type).toBe("publicKey");
      expect(finalCond.fields[2]!.type).toBe("publicKey");
    });
  });

  describe("serialization roundtrip", () => {
    test("multi-sig tx survives serialize → deserialize", () => {
      const tx = buildTokenTransfer({
        recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        amount: 1000n,
        fee: 200n,
        nonce: 0n,
        publicKeys,
        signaturesRequired: 2,
      });

      // 2-of-3 sign
      const partial = signMultiSig(tx, KEY1, publicKeys);
      const full = signMultiSig(partial, KEY2, publicKeys);

      // Serialize
      const bytes = serializeTransaction(full);
      const hex = bytesToHex(bytes);

      // Deserialize
      const restored = deserializeTransaction(hex);
      const cond = restored.auth.spendingCondition as MultiSigSpendingCondition;

      expect(cond.signaturesRequired).toBe(2);
      expect(cond.fields.length).toBe(3);
      expect(cond.fields[0]!.type).toBe("signature");
      expect(cond.fields[1]!.type).toBe("signature");
      expect(cond.fields[2]!.type).toBe("publicKey");
      expect(cond.signer).toBe(
        (full.auth.spendingCondition as MultiSigSpendingCondition).signer
      );
    });
  });

  describe("build.ts _multisig metadata", () => {
    test("buildTokenTransfer attaches _multisig when publicKeys used", () => {
      const tx = buildTokenTransfer({
        recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        amount: 1000n,
        fee: 200n,
        nonce: 0n,
        publicKeys,
        signaturesRequired: 2,
      });

      expect((tx as any)._multisig).toBeDefined();
      expect((tx as any)._multisig.publicKeys).toEqual(publicKeys);
    });

    test("buildTokenTransfer does not attach _multisig for single-sig", () => {
      const tx = buildTokenTransfer({
        recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        amount: 1000n,
        fee: 200n,
        nonce: 0n,
        publicKey: pubkey1,
      });

      expect((tx as any)._multisig).toBeUndefined();
    });
  });

  describe("non-sequential multi-sig (SIP-027)", () => {
    const buildNonSeqTx = () =>
      buildTokenTransfer({
        recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        amount: 1000n,
        fee: 200n,
        nonce: 0n,
        publicKeys,
        signaturesRequired: 2,
        hashMode: AddressHashMode.P2SH_NonSequential,
      });

    test("isNonSequential detects hash modes correctly", () => {
      expect(isNonSequential(0x00)).toBe(false); // P2PKH
      expect(isNonSequential(0x01)).toBe(false); // P2SH
      expect(isNonSequential(0x02)).toBe(false); // P2WPKH
      expect(isNonSequential(0x03)).toBe(false); // P2WSH
      expect(isNonSequential(0x05)).toBe(true);  // P2SH_NonSequential
      expect(isNonSequential(0x07)).toBe(true);  // P2WSH_P2SH_NonSequential
    });

    test("builds tx with non-sequential hash mode", () => {
      const tx = buildNonSeqTx();
      const cond = tx.auth.spendingCondition as MultiSigSpendingCondition;
      expect(cond.hashMode).toBe(0x05);
      expect(cond.signaturesRequired).toBe(2);
      expect(cond.fields).toEqual([]);
    });

    test("2-of-3 pass-through signing (order-independent)", () => {
      const tx = buildNonSeqTx();

      // Sign with key1, then key2 — order doesn't matter
      const partial = signMultiSig(tx, KEY1, publicKeys);
      const partialCond = partial.auth.spendingCondition as MultiSigSpendingCondition;
      expect(partialCond.fields.length).toBe(1);
      expect(partialCond.fields[0]!.type).toBe("signature");

      const full = signMultiSig(partial, KEY2, publicKeys);
      const fullCond = full.auth.spendingCondition as MultiSigSpendingCondition;
      // Non-sequential: only signature fields, no pubkey gap-filling
      expect(fullCond.fields.length).toBe(2);
      expect(fullCond.fields[0]!.type).toBe("signature");
      expect(fullCond.fields[1]!.type).toBe("signature");
    });

    test("independent signing produces same signatures", () => {
      const tx = buildNonSeqTx();

      // Each signer signs the original unsigned tx independently
      const signed1 = signMultiSig(tx, KEY1, publicKeys);
      const signed2 = signMultiSig(tx, KEY2, publicKeys);

      // Pass-through should produce same sig for key1
      const passThrough1 = signMultiSig(tx, KEY1, publicKeys);
      const passThrough2 = signMultiSig(passThrough1, KEY2, publicKeys);

      const sig1Independent = (signed1.auth.spendingCondition as MultiSigSpendingCondition).fields[0]!.data;
      const sig1PassThrough = (passThrough2.auth.spendingCondition as MultiSigSpendingCondition).fields[0]!.data;
      expect(sig1Independent).toBe(sig1PassThrough);
    });

    test("combineMultiSigSignatures merges independent signatures", () => {
      const tx = buildNonSeqTx();

      const signed1 = signMultiSig(tx, KEY1, publicKeys);
      const signed2 = signMultiSig(tx, KEY2, publicKeys);

      const combined = combineMultiSigSignatures(tx, [signed1, signed2]);
      const cond = combined.auth.spendingCondition as MultiSigSpendingCondition;

      expect(cond.fields.length).toBe(2);
      expect(cond.fields[0]!.type).toBe("signature");
      expect(cond.fields[1]!.type).toBe("signature");

      // Signatures match the independent ones
      const sig1 = (signed1.auth.spendingCondition as MultiSigSpendingCondition).fields[0]!.data;
      const sig2 = (signed2.auth.spendingCondition as MultiSigSpendingCondition).fields[0]!.data;
      expect(cond.fields[0]!.data).toBe(sig1);
      expect(cond.fields[1]!.data).toBe(sig2);
    });

    test("combineMultiSigSignatures deduplicates", () => {
      const tx = buildNonSeqTx();

      const signed1 = signMultiSig(tx, KEY1, publicKeys);
      // Pass the same signed tx twice
      const combined = combineMultiSigSignatures(tx, [signed1, signed1]);
      const cond = combined.auth.spendingCondition as MultiSigSpendingCondition;

      expect(cond.fields.length).toBe(1);
    });

    test("combineMultiSigSignatures errors on sequential hash mode", () => {
      const seqTx = buildTokenTransfer({
        recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        amount: 1000n,
        fee: 200n,
        nonce: 0n,
        publicKeys,
        signaturesRequired: 2,
      });

      expect(() => combineMultiSigSignatures(seqTx, [])).toThrow("non-sequential");
    });

    test("combineMultiSigSignatures errors with no signatures", () => {
      const tx = buildNonSeqTx();
      expect(() => combineMultiSigSignatures(tx, [tx])).toThrow("No signatures");
    });

    test("finalizeMultiSig is no-op for non-sequential", () => {
      const tx = buildNonSeqTx();
      const signed = signMultiSig(tx, KEY1, publicKeys);
      const finalized = finalizeMultiSig(signed, publicKeys);

      // Should be unchanged — no pubkey gap-filling
      const cond = finalized.auth.spendingCondition as MultiSigSpendingCondition;
      expect(cond.fields.length).toBe(1);
    });

    test("serialization roundtrip with 0x05 hashMode", () => {
      const tx = buildNonSeqTx();
      const signed1 = signMultiSig(tx, KEY1, publicKeys);
      const signed2 = signMultiSig(tx, KEY2, publicKeys);
      const combined = combineMultiSigSignatures(tx, [signed1, signed2]);

      const bytes = serializeTransaction(combined);
      const hex = bytesToHex(bytes);
      const restored = deserializeTransaction(hex);

      const cond = restored.auth.spendingCondition as MultiSigSpendingCondition;
      expect(cond.hashMode).toBe(0x05);
      expect(cond.signaturesRequired).toBe(2);
      expect(cond.fields.length).toBe(2);
      expect(cond.fields[0]!.type).toBe("signature");
      expect(cond.fields[1]!.type).toBe("signature");
      expect(cond.signer).toBe(
        (combined.auth.spendingCondition as MultiSigSpendingCondition).signer
      );
    });

    test("combine and pass-through produce same signatures", () => {
      const tx = buildNonSeqTx();

      // Pattern A: Pass-through
      const partial = signMultiSig(tx, KEY1, publicKeys);
      const passThrough = signMultiSig(partial, KEY2, publicKeys);

      // Pattern B: Independent + combine
      const indep1 = signMultiSig(tx, KEY1, publicKeys);
      const indep2 = signMultiSig(tx, KEY2, publicKeys);
      const combined = combineMultiSigSignatures(tx, [indep1, indep2]);

      const ptCond = passThrough.auth.spendingCondition as MultiSigSpendingCondition;
      const cbCond = combined.auth.spendingCondition as MultiSigSpendingCondition;

      // Same signature data for both signers
      expect(ptCond.fields[0]!.data).toBe(cbCond.fields[0]!.data);
      expect(ptCond.fields[1]!.data).toBe(cbCond.fields[1]!.data);
    });
  });
});
