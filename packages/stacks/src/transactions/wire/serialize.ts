import {
  bytesToHex,
  hexToBytes,
  concatBytes,
  intToBytes,
  intToHex,
  utf8ToBytes,
  asciiToBytes,
  writeUInt32BE,
  writeUInt16BE,
  writeUInt8,
} from "../../utils/encoding.ts";
import { c32addressDecode } from "c32check";
import { serializeCVBytes } from "../../clarity/serialize.ts";
import {
  AuthType,
  PayloadType,
  PostConditionPrincipalId,
  AssetType,
  RECOVERABLE_ECDSA_SIG_LENGTH_BYTES,
  MEMO_MAX_LENGTH_BYTES,
  type StacksTransaction,
  type Authorization,
  type SpendingCondition,
  type SingleSigSpendingCondition,
  type MultiSigSpendingCondition,
  type TransactionPayload,
  type PostConditionWire,
  type PostConditionPrincipalWire,
  type AssetInfoWire,
  type TransactionAuthField,
  type AuthFieldType,
} from "../types.ts";

// Address serialization: version (1 byte) + hash160 (20 bytes)
function serializeAddress(c32Address: string): Uint8Array {
  const [version, hash160] = c32addressDecode(c32Address);
  return concatBytes(new Uint8Array([version]), hexToBytes(hash160));
}

// LP string: length prefix (n bytes) + content bytes
function serializeLPString(str: string, prefixBytes = 1): Uint8Array {
  const content = utf8ToBytes(str);
  const prefix = hexToBytes(intToHex(content.byteLength, prefixBytes));
  return concatBytes(prefix, content);
}

// LP string for code body (4-byte prefix)
function serializeLPStringLong(str: string): Uint8Array {
  return serializeLPString(str, 4);
}

// Memo: padded to MEMO_MAX_LENGTH_BYTES
function serializeMemo(memo: string): Uint8Array {
  const content = asciiToBytes(memo);
  const padded = new Uint8Array(MEMO_MAX_LENGTH_BYTES);
  padded.set(content.slice(0, MEMO_MAX_LENGTH_BYTES));
  return concatBytes(writeUInt8(content.length), padded);
}

function serializeSpendingCondition(condition: SpendingCondition): Uint8Array {
  const parts: Uint8Array[] = [
    writeUInt8(condition.hashMode),
    hexToBytes(condition.signer), // 20 bytes
    intToBytes(condition.nonce, 8),
    intToBytes(condition.fee, 8),
  ];

  if ("signature" in condition) {
    // Single sig
    const sc = condition as SingleSigSpendingCondition;
    parts.push(writeUInt8(sc.keyEncoding));
    parts.push(hexToBytes(sc.signature)); // 65 bytes
  } else {
    // Multi sig
    const mc = condition as MultiSigSpendingCondition;
    // Fields as LP list
    parts.push(writeUInt32BE(mc.fields.length));
    for (const field of mc.fields) {
      parts.push(serializeAuthField(field));
    }
    parts.push(writeUInt16BE(mc.signaturesRequired));
  }

  return concatBytes(...parts);
}

function serializeAuthField(field: TransactionAuthField): Uint8Array {
  if (field.type === "publicKey") {
    const typeId = field.pubKeyEncoding === 0x00 ? 0x00 : 0x01;
    return concatBytes(writeUInt8(typeId), hexToBytes(field.data));
  } else {
    const typeId = field.pubKeyEncoding === 0x00 ? 0x02 : 0x03;
    return concatBytes(writeUInt8(typeId), hexToBytes(field.data));
  }
}

function serializeAuthorization(auth: Authorization): Uint8Array {
  const parts: Uint8Array[] = [writeUInt8(auth.authType)];
  parts.push(serializeSpendingCondition(auth.spendingCondition));
  if (auth.authType === AuthType.Sponsored) {
    parts.push(serializeSpendingCondition(auth.sponsorSpendingCondition));
  }
  return concatBytes(...parts);
}

function serializePrincipal(principal: PostConditionPrincipalWire): Uint8Array {
  switch (principal.type) {
    case "origin":
      return writeUInt8(PostConditionPrincipalId.Origin);
    case "standard":
      return concatBytes(
        writeUInt8(PostConditionPrincipalId.Standard),
        serializeAddress(principal.address)
      );
    case "contract":
      return concatBytes(
        writeUInt8(PostConditionPrincipalId.Contract),
        serializeAddress(principal.address),
        serializeLPString(principal.contractName)
      );
  }
}

function serializeAssetInfo(asset: AssetInfoWire): Uint8Array {
  return concatBytes(
    serializeAddress(asset.address),
    serializeLPString(asset.contractName),
    serializeLPString(asset.assetName)
  );
}

function serializePostCondition(pc: PostConditionWire): Uint8Array {
  const parts: Uint8Array[] = [serializePrincipal(pc.principal)];

  switch (pc.type) {
    case "stx":
      parts.push(writeUInt8(AssetType.STX));
      parts.push(writeUInt8(pc.conditionCode));
      parts.push(intToBytes(pc.amount, 8));
      break;
    case "ft":
      parts.push(writeUInt8(AssetType.Fungible));
      parts.push(serializeAssetInfo(pc.asset));
      parts.push(writeUInt8(pc.conditionCode));
      parts.push(intToBytes(pc.amount, 8));
      break;
    case "nft":
      parts.push(writeUInt8(AssetType.NonFungible));
      parts.push(serializeAssetInfo(pc.asset));
      parts.push(serializeCVBytes(pc.assetId));
      parts.push(writeUInt8(pc.conditionCode));
      break;
  }

  return concatBytes(...parts);
}

function serializePostConditions(pcs: PostConditionWire[]): Uint8Array {
  const parts: Uint8Array[] = [writeUInt32BE(pcs.length)];
  for (const pc of pcs) {
    parts.push(serializePostCondition(pc));
  }
  return concatBytes(...parts);
}

function serializePayload(payload: TransactionPayload): Uint8Array {
  const parts: Uint8Array[] = [writeUInt8(payload.payloadType)];

  switch (payload.payloadType) {
    case PayloadType.TokenTransfer:
      parts.push(serializeCVBytes(payload.recipient));
      parts.push(intToBytes(payload.amount, 8));
      parts.push(serializeMemo(payload.memo));
      break;

    case PayloadType.ContractCall:
      parts.push(serializeAddress(payload.contractAddress));
      parts.push(serializeLPString(payload.contractName));
      parts.push(serializeLPString(payload.functionName));
      parts.push(writeUInt32BE(payload.functionArgs.length));
      for (const arg of payload.functionArgs) {
        parts.push(serializeCVBytes(arg));
      }
      break;

    case PayloadType.SmartContract:
      parts.push(serializeLPString(payload.contractName));
      parts.push(serializeLPStringLong(payload.codeBody));
      break;

    case PayloadType.VersionedSmartContract:
      parts.push(writeUInt8(payload.clarityVersion ?? 2));
      parts.push(serializeLPString(payload.contractName));
      parts.push(serializeLPStringLong(payload.codeBody));
      break;
  }

  return concatBytes(...parts);
}

export function serializeTransaction(tx: StacksTransaction): Uint8Array {
  return concatBytes(
    writeUInt8(tx.version),
    writeUInt32BE(tx.chainId),
    serializeAuthorization(tx.auth),
    writeUInt8(tx.anchorMode),
    writeUInt8(tx.postConditionMode),
    serializePostConditions(tx.postConditions),
    serializePayload(tx.payload)
  );
}

export function serializeTransactionHex(tx: StacksTransaction): string {
  return bytesToHex(serializeTransaction(tx));
}
