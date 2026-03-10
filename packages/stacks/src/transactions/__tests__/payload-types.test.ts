import { describe, expect, test } from "bun:test";
import { bytesToHex, hexToBytes, concatBytes, writeUInt32BE, writeUInt16BE, writeUInt8 } from "../../utils/encoding.ts";
import { serializeTransaction } from "../wire/serialize.ts";
import { deserializeTransaction } from "../wire/deserialize.ts";
import {
  PayloadType,
  AuthType,
  AddressHashMode,
  AnchorMode,
  PostConditionModeWire,
  COINBASE_BYTES_LENGTH,
  VRF_PROOF_BYTES_LENGTH,
  MICROBLOCK_HEADER_BYTES_LENGTH,
  RECOVERABLE_ECDSA_SIG_LENGTH_BYTES,
  TenureChangeCause,
  type CoinbasePayload,
  type CoinbaseToAltRecipientPayload,
  type PoisonMicroblockPayload,
  type TenureChangePayload,
  type NakamotoCoinbasePayload,
} from "../types.ts";

// Helpers to build a minimal valid tx wrapper around a payload
function makeStandardAuthBytes(): Uint8Array {
  // Standard auth (0x04) + P2PKH spending condition
  return concatBytes(
    writeUInt8(AuthType.Standard),     // auth type
    writeUInt8(AddressHashMode.P2PKH), // hash mode
    new Uint8Array(20),                // signer (20 zero bytes)
    new Uint8Array(8),                 // nonce (0)
    new Uint8Array(8),                 // fee (0)
    writeUInt8(0x00),                  // key encoding (compressed)
    new Uint8Array(RECOVERABLE_ECDSA_SIG_LENGTH_BYTES), // signature (65 zero bytes)
  );
}

function wrapPayload(payloadBytes: Uint8Array): Uint8Array {
  return concatBytes(
    writeUInt8(0x00),                        // version (mainnet)
    writeUInt32BE(0x00000001),               // chain ID
    makeStandardAuthBytes(),                 // auth
    writeUInt8(AnchorMode.Any),              // anchor mode
    writeUInt8(PostConditionModeWire.Allow), // post condition mode
    writeUInt32BE(0),                        // 0 post conditions
    payloadBytes,                            // payload
  );
}

describe("payload type: Coinbase (0x04)", () => {
  const coinbaseBuffer = "aa".repeat(32);

  function makeCoinbaseBytes(): Uint8Array {
    return concatBytes(
      writeUInt8(PayloadType.Coinbase),
      hexToBytes(coinbaseBuffer),
    );
  }

  test("deserializes coinbase payload", () => {
    const raw = wrapPayload(makeCoinbaseBytes());
    const tx = deserializeTransaction(raw);

    expect(tx.payload.payloadType).toBe(PayloadType.Coinbase);
    const payload = tx.payload as CoinbasePayload;
    expect(payload.coinbaseBuffer).toBe(coinbaseBuffer);
  });

  test("serialization roundtrip", () => {
    const raw = wrapPayload(makeCoinbaseBytes());
    const tx = deserializeTransaction(raw);
    const reserialized = serializeTransaction(tx);
    expect(bytesToHex(reserialized)).toBe(bytesToHex(raw));
  });

  test("zero-filled coinbase buffer", () => {
    const zeroBuffer = "00".repeat(32);
    const bytes = concatBytes(
      writeUInt8(PayloadType.Coinbase),
      new Uint8Array(COINBASE_BYTES_LENGTH),
    );
    const raw = wrapPayload(bytes);
    const tx = deserializeTransaction(raw);
    const payload = tx.payload as CoinbasePayload;
    expect(payload.coinbaseBuffer).toBe(zeroBuffer);
  });
});

describe("payload type: CoinbaseToAltRecipient (0x05)", () => {
  const coinbaseBuffer = "bb".repeat(32);

  test("deserializes with standard principal recipient", () => {
    // Standard principal CV: type 0x05 + version(1) + hash160(20)
    const principalCV = concatBytes(
      writeUInt8(0x05), // ClarityWireType.address
      writeUInt8(22),   // address version (mainnet single-sig)
      hexToBytes("1111111111111111111111111111111111111111"),
    );
    const bytes = concatBytes(
      writeUInt8(PayloadType.CoinbaseToAltRecipient),
      hexToBytes(coinbaseBuffer),
      principalCV,
    );
    const raw = wrapPayload(bytes);
    const tx = deserializeTransaction(raw);

    expect(tx.payload.payloadType).toBe(PayloadType.CoinbaseToAltRecipient);
    const payload = tx.payload as CoinbaseToAltRecipientPayload;
    expect(payload.coinbaseBuffer).toBe(coinbaseBuffer);
    expect(payload.recipient.type).toBe("address");
  });

  test("deserializes with contract principal recipient", () => {
    // Contract principal CV: type 0x06 + address + LP string name
    const name = new TextEncoder().encode("my-contract");
    const principalCV = concatBytes(
      writeUInt8(0x06), // ClarityWireType.contract
      writeUInt8(22),   // address version
      hexToBytes("2222222222222222222222222222222222222222"),
      writeUInt8(name.length),
      name,
    );
    const bytes = concatBytes(
      writeUInt8(PayloadType.CoinbaseToAltRecipient),
      hexToBytes(coinbaseBuffer),
      principalCV,
    );
    const raw = wrapPayload(bytes);
    const tx = deserializeTransaction(raw);

    const payload = tx.payload as CoinbaseToAltRecipientPayload;
    expect(payload.recipient.type).toBe("contract");
  });

  test("serialization roundtrip", () => {
    const principalCV = concatBytes(
      writeUInt8(0x05),
      writeUInt8(22),
      hexToBytes("1111111111111111111111111111111111111111"),
    );
    const bytes = concatBytes(
      writeUInt8(PayloadType.CoinbaseToAltRecipient),
      hexToBytes(coinbaseBuffer),
      principalCV,
    );
    const raw = wrapPayload(bytes);
    const tx = deserializeTransaction(raw);
    const reserialized = serializeTransaction(tx);
    expect(bytesToHex(reserialized)).toBe(bytesToHex(raw));
  });
});

describe("payload type: PoisonMicroblock (0x03)", () => {
  function makeMicroblockHeader(): Uint8Array {
    // version(1) + sequence(2) + prev_block(32) + tx_merkle_root(32) + signature(65) = 132
    return concatBytes(
      writeUInt8(0x01),                                             // version
      writeUInt16BE(0x0001),                                        // sequence
      hexToBytes("cc".repeat(32)),                                  // prev_block
      hexToBytes("dd".repeat(32)),                                  // tx_merkle_root
      hexToBytes("ee".repeat(RECOVERABLE_ECDSA_SIG_LENGTH_BYTES)), // signature
    );
  }

  test("deserializes poison microblock payload", () => {
    const header1 = makeMicroblockHeader();
    const header2 = makeMicroblockHeader();
    expect(header1.length).toBe(MICROBLOCK_HEADER_BYTES_LENGTH);

    const bytes = concatBytes(
      writeUInt8(PayloadType.PoisonMicroblock),
      header1,
      header2,
    );
    const raw = wrapPayload(bytes);
    const tx = deserializeTransaction(raw);

    expect(tx.payload.payloadType).toBe(PayloadType.PoisonMicroblock);
    const payload = tx.payload as PoisonMicroblockPayload;
    expect(payload.header1).toBe(bytesToHex(header1));
    expect(payload.header2).toBe(bytesToHex(header2));
  });

  test("serialization roundtrip", () => {
    const bytes = concatBytes(
      writeUInt8(PayloadType.PoisonMicroblock),
      makeMicroblockHeader(),
      makeMicroblockHeader(),
    );
    const raw = wrapPayload(bytes);
    const tx = deserializeTransaction(raw);
    const reserialized = serializeTransaction(tx);
    expect(bytesToHex(reserialized)).toBe(bytesToHex(raw));
  });
});

describe("payload type: TenureChange (0x07)", () => {
  const tenureConsensusHash = "aa".repeat(20);
  const prevTenureConsensusHash = "bb".repeat(20);
  const burnViewConsensusHash = "cc".repeat(20);
  const previousTenureEnd = "dd".repeat(32);
  const pubkeyHash = "ee".repeat(20);

  function makeTenureChangeBytes(cause: TenureChangeCause = TenureChangeCause.BlockFound, blocks = 10): Uint8Array {
    return concatBytes(
      writeUInt8(PayloadType.TenureChange),
      hexToBytes(tenureConsensusHash),
      hexToBytes(prevTenureConsensusHash),
      hexToBytes(burnViewConsensusHash),
      hexToBytes(previousTenureEnd),
      writeUInt32BE(blocks),
      writeUInt8(cause),
      hexToBytes(pubkeyHash),
    );
  }

  test("deserializes tenure change (BlockFound)", () => {
    const raw = wrapPayload(makeTenureChangeBytes(TenureChangeCause.BlockFound, 42));
    const tx = deserializeTransaction(raw);

    expect(tx.payload.payloadType).toBe(PayloadType.TenureChange);
    const payload = tx.payload as TenureChangePayload;
    expect(payload.tenureConsensusHash).toBe(tenureConsensusHash);
    expect(payload.prevTenureConsensusHash).toBe(prevTenureConsensusHash);
    expect(payload.burnViewConsensusHash).toBe(burnViewConsensusHash);
    expect(payload.previousTenureEnd).toBe(previousTenureEnd);
    expect(payload.previousTenureBlocks).toBe(42);
    expect(payload.cause).toBe(TenureChangeCause.BlockFound);
    expect(payload.pubkeyHash).toBe(pubkeyHash);
  });

  test("deserializes tenure change (Extended)", () => {
    const raw = wrapPayload(makeTenureChangeBytes(TenureChangeCause.Extended, 100));
    const tx = deserializeTransaction(raw);
    const payload = tx.payload as TenureChangePayload;
    expect(payload.cause).toBe(TenureChangeCause.Extended);
    expect(payload.previousTenureBlocks).toBe(100);
  });

  test("serialization roundtrip", () => {
    const raw = wrapPayload(makeTenureChangeBytes());
    const tx = deserializeTransaction(raw);
    const reserialized = serializeTransaction(tx);
    expect(bytesToHex(reserialized)).toBe(bytesToHex(raw));
  });
});

describe("payload type: NakamotoCoinbase (0x08)", () => {
  const coinbaseBuffer = "ff".repeat(32);
  const vrfProof = "ab".repeat(VRF_PROOF_BYTES_LENGTH);

  test("deserializes with no recipient (none)", () => {
    const bytes = concatBytes(
      writeUInt8(PayloadType.NakamotoCoinbase),
      hexToBytes(coinbaseBuffer),
      writeUInt8(0x09), // ClarityWireType.none
      hexToBytes(vrfProof),
    );
    const raw = wrapPayload(bytes);
    const tx = deserializeTransaction(raw);

    expect(tx.payload.payloadType).toBe(PayloadType.NakamotoCoinbase);
    const payload = tx.payload as NakamotoCoinbasePayload;
    expect(payload.coinbaseBuffer).toBe(coinbaseBuffer);
    expect(payload.recipient).toBeNull();
    expect(payload.vrfProof).toBe(vrfProof);
  });

  test("deserializes with standard principal recipient", () => {
    const principalBytes = concatBytes(
      writeUInt8(0x05), // standard principal
      writeUInt8(22),   // version
      hexToBytes("1111111111111111111111111111111111111111"),
    );
    const someBytes = concatBytes(
      writeUInt8(0x0a), // ClarityWireType.some
      principalBytes,
    );
    const bytes = concatBytes(
      writeUInt8(PayloadType.NakamotoCoinbase),
      hexToBytes(coinbaseBuffer),
      someBytes,
      hexToBytes(vrfProof),
    );
    const raw = wrapPayload(bytes);
    const tx = deserializeTransaction(raw);

    const payload = tx.payload as NakamotoCoinbasePayload;
    expect(payload.recipient).not.toBeNull();
    expect(payload.recipient!.type).toBe("address");
  });

  test("serialization roundtrip (no recipient)", () => {
    const bytes = concatBytes(
      writeUInt8(PayloadType.NakamotoCoinbase),
      hexToBytes(coinbaseBuffer),
      writeUInt8(0x09), // none
      hexToBytes(vrfProof),
    );
    const raw = wrapPayload(bytes);
    const tx = deserializeTransaction(raw);
    const reserialized = serializeTransaction(tx);
    expect(bytesToHex(reserialized)).toBe(bytesToHex(raw));
  });

  test("serialization roundtrip (with recipient)", () => {
    const principalBytes = concatBytes(
      writeUInt8(0x05),
      writeUInt8(22),
      hexToBytes("1111111111111111111111111111111111111111"),
    );
    const someBytes = concatBytes(
      writeUInt8(0x0a),
      principalBytes,
    );
    const bytes = concatBytes(
      writeUInt8(PayloadType.NakamotoCoinbase),
      hexToBytes(coinbaseBuffer),
      someBytes,
      hexToBytes(vrfProof),
    );
    const raw = wrapPayload(bytes);
    const tx = deserializeTransaction(raw);
    const reserialized = serializeTransaction(tx);
    expect(bytesToHex(reserialized)).toBe(bytesToHex(raw));
  });
});

describe("parser integration: TX_TYPE_NAMES coverage", () => {
  test("all payload types can be deserialized without throwing", () => {
    // Coinbase
    const coinbase = wrapPayload(concatBytes(
      writeUInt8(PayloadType.Coinbase),
      new Uint8Array(COINBASE_BYTES_LENGTH),
    ));
    expect(() => deserializeTransaction(coinbase)).not.toThrow();

    // CoinbaseToAltRecipient
    const cbAlt = wrapPayload(concatBytes(
      writeUInt8(PayloadType.CoinbaseToAltRecipient),
      new Uint8Array(COINBASE_BYTES_LENGTH),
      writeUInt8(0x05), writeUInt8(22), new Uint8Array(20), // standard principal
    ));
    expect(() => deserializeTransaction(cbAlt)).not.toThrow();

    // PoisonMicroblock
    const poison = wrapPayload(concatBytes(
      writeUInt8(PayloadType.PoisonMicroblock),
      new Uint8Array(MICROBLOCK_HEADER_BYTES_LENGTH),
      new Uint8Array(MICROBLOCK_HEADER_BYTES_LENGTH),
    ));
    expect(() => deserializeTransaction(poison)).not.toThrow();

    // TenureChange
    const tenure = wrapPayload(concatBytes(
      writeUInt8(PayloadType.TenureChange),
      new Uint8Array(20), new Uint8Array(20), new Uint8Array(20), // 3 consensus hashes
      new Uint8Array(32), // previous tenure end
      writeUInt32BE(1),   // blocks
      writeUInt8(0),      // cause
      new Uint8Array(20), // pubkey hash
    ));
    expect(() => deserializeTransaction(tenure)).not.toThrow();

    // NakamotoCoinbase
    const nakamoto = wrapPayload(concatBytes(
      writeUInt8(PayloadType.NakamotoCoinbase),
      new Uint8Array(COINBASE_BYTES_LENGTH),
      writeUInt8(0x09), // none
      new Uint8Array(VRF_PROOF_BYTES_LENGTH),
    ));
    expect(() => deserializeTransaction(nakamoto)).not.toThrow();
  });
});
