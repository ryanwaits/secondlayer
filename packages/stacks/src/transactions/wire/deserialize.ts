import {
  bytesToHex,
  hexToBytes,
  bytesToAscii,
  bytesToUtf8,
  without0x,
} from "../../utils/encoding.ts";
import { c32address } from "../../utils/c32.ts";
import {
  AuthType,
  PayloadType,
  AddressHashMode,
  PostConditionPrincipalId,
  AssetType,
  RECOVERABLE_ECDSA_SIG_LENGTH_BYTES,
  MEMO_MAX_LENGTH_BYTES,
  type StacksTransaction,
  type Authorization,
  type SpendingCondition,
  type TransactionPayload,
  type PostConditionWire,
  type PostConditionPrincipalWire,
  type AssetInfoWire,
  type TransactionAuthField,
  type AnchorMode,
  type PostConditionModeWire,
  type ClarityVersion,
} from "../types.ts";
import type { ClarityValue } from "../../clarity/types.ts";
import { clarityTypeFromByte } from "../../clarity/types.ts";
import {
  intCV,
  uintCV,
  trueCV,
  falseCV,
  bufferCV,
  noneCV,
  someCV,
  responseOkCV,
  responseErrorCV,
  standardPrincipalCV,
  contractPrincipalCV,
  listCV,
  tupleCV,
  stringAsciiCV,
  stringUtf8CV,
} from "../../clarity/values.ts";
import { bytesToTwosBigInt } from "../../utils/encoding.ts";

class Reader {
  private data: Uint8Array;
  public offset = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  readUInt8(): number {
    return this.data[this.offset++]!;
  }

  readUInt16BE(): number {
    const val = ((this.data[this.offset]! << 8) | this.data[this.offset + 1]!) >>> 0;
    this.offset += 2;
    return val;
  }

  readUInt32BE(): number {
    const val =
      ((this.data[this.offset]! << 24) |
        (this.data[this.offset + 1]! << 16) |
        (this.data[this.offset + 2]! << 8) |
        this.data[this.offset + 3]!) >>>
      0;
    this.offset += 4;
    return val;
  }

  readBytes(length: number): Uint8Array {
    const slice = this.data.slice(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  readBigUInt64BE(): bigint {
    return BigInt(`0x${bytesToHex(this.readBytes(8))}`);
  }
}

function readAddress(r: Reader): string {
  const version = r.readUInt8();
  const hash160 = bytesToHex(r.readBytes(20));
  return c32address(version, hash160);
}

function readLPString(r: Reader, prefixBytes = 1): string {
  let length = 0;
  for (let i = 0; i < prefixBytes; i++) {
    length = (length << 8) | r.readUInt8();
  }
  return bytesToUtf8(r.readBytes(length));
}

function readCV(r: Reader): ClarityValue {
  const typeByte = r.readUInt8();
  const type = clarityTypeFromByte(typeByte);

  switch (type) {
    case "int":
      return intCV(bytesToTwosBigInt(r.readBytes(16)));
    case "uint":
      return uintCV(r.readBytes(16));
    case "true":
      return trueCV();
    case "false":
      return falseCV();
    case "buffer": {
      const len = r.readUInt32BE();
      return bufferCV(r.readBytes(len));
    }
    case "none":
      return noneCV();
    case "some":
      return someCV(readCV(r));
    case "ok":
      return responseOkCV(readCV(r));
    case "err":
      return responseErrorCV(readCV(r));
    case "address":
      return standardPrincipalCV(readAddress(r));
    case "contract": {
      const addr = readAddress(r);
      const name = readLPString(r);
      return contractPrincipalCV(addr, name);
    }
    case "list": {
      const len = r.readUInt32BE();
      const items: ClarityValue[] = [];
      for (let i = 0; i < len; i++) items.push(readCV(r));
      return listCV(items);
    }
    case "tuple": {
      const len = r.readUInt32BE();
      const data: Record<string, ClarityValue> = {};
      for (let i = 0; i < len; i++) {
        const key = readLPString(r);
        data[key] = readCV(r);
      }
      return tupleCV(data);
    }
    case "ascii": {
      const len = r.readUInt32BE();
      return stringAsciiCV(bytesToAscii(r.readBytes(len)));
    }
    case "utf8": {
      const len = r.readUInt32BE();
      return stringUtf8CV(bytesToUtf8(r.readBytes(len)));
    }
    default:
      throw new Error(`Unknown clarity type: ${type}`);
  }
}

function readSpendingCondition(r: Reader): SpendingCondition {
  const hashMode = r.readUInt8();
  const signer = bytesToHex(r.readBytes(20));
  const nonce = r.readBigUInt64BE();
  const fee = r.readBigUInt64BE();

  if (hashMode === AddressHashMode.P2PKH || hashMode === AddressHashMode.P2WPKH) {
    const keyEncoding = r.readUInt8();
    const signature = bytesToHex(r.readBytes(RECOVERABLE_ECDSA_SIG_LENGTH_BYTES));
    return { hashMode, signer, nonce, fee, keyEncoding, signature } as SpendingCondition;
  }

  const fieldCount = r.readUInt32BE();
  const fields: TransactionAuthField[] = [];
  for (let i = 0; i < fieldCount; i++) {
    const fieldType = r.readUInt8();
    if (fieldType <= 0x01) {
      const keyLen = fieldType === 0x00 ? 33 : 65;
      fields.push({
        type: "publicKey",
        pubKeyEncoding: fieldType as 0x00 | 0x01,
        data: bytesToHex(r.readBytes(keyLen)),
      });
    } else {
      fields.push({
        type: "signature",
        pubKeyEncoding: (fieldType === 0x02 ? 0x00 : 0x01) as 0x00 | 0x01,
        data: bytesToHex(r.readBytes(RECOVERABLE_ECDSA_SIG_LENGTH_BYTES)),
      });
    }
  }
  const signaturesRequired = r.readUInt16BE();

  return { hashMode, signer, nonce, fee, fields, signaturesRequired } as SpendingCondition;
}

function readAuthorization(r: Reader): Authorization {
  const authType = r.readUInt8();
  const spendingCondition = readSpendingCondition(r);

  if (authType === AuthType.Standard) {
    return { authType: AuthType.Standard, spendingCondition };
  }

  const sponsorSpendingCondition = readSpendingCondition(r);
  return {
    authType: AuthType.Sponsored,
    spendingCondition,
    sponsorSpendingCondition,
  };
}

function readAssetInfo(r: Reader): AssetInfoWire {
  return {
    address: readAddress(r),
    contractName: readLPString(r),
    assetName: readLPString(r),
  };
}

function readPostConditionPrincipal(r: Reader): PostConditionPrincipalWire {
  const type = r.readUInt8();
  switch (type) {
    case PostConditionPrincipalId.Origin:
      return { type: "origin" };
    case PostConditionPrincipalId.Standard:
      return { type: "standard", address: readAddress(r) };
    case PostConditionPrincipalId.Contract:
      return { type: "contract", address: readAddress(r), contractName: readLPString(r) };
    default:
      throw new Error(`Unknown post condition principal type: ${type}`);
  }
}

function readPostConditions(r: Reader): PostConditionWire[] {
  const count = r.readUInt32BE();
  const pcs: PostConditionWire[] = [];
  for (let i = 0; i < count; i++) {
    const principal = readPostConditionPrincipal(r);
    const assetType = r.readUInt8();
    switch (assetType) {
      case AssetType.STX:
        pcs.push({ type: "stx", principal, conditionCode: r.readUInt8(), amount: r.readBigUInt64BE() });
        break;
      case AssetType.Fungible:
        pcs.push({ type: "ft", principal, asset: readAssetInfo(r), conditionCode: r.readUInt8(), amount: r.readBigUInt64BE() });
        break;
      case AssetType.NonFungible:
        pcs.push({ type: "nft", principal, asset: readAssetInfo(r), assetId: readCV(r), conditionCode: r.readUInt8() });
        break;
    }
  }
  return pcs;
}

function readPayload(r: Reader): TransactionPayload {
  const payloadType = r.readUInt8();

  switch (payloadType) {
    case PayloadType.TokenTransfer: {
      const recipient = readCV(r);
      const amount = r.readBigUInt64BE();
      const memoContentLen = r.readUInt8();
      const memoBytes = r.readBytes(MEMO_MAX_LENGTH_BYTES);
      const memo = bytesToAscii(memoBytes.slice(0, memoContentLen)).replace(/\0+$/, "");
      return { payloadType: PayloadType.TokenTransfer, recipient, amount, memo };
    }
    case PayloadType.ContractCall: {
      const contractAddress = readAddress(r);
      const contractName = readLPString(r);
      const functionName = readLPString(r);
      const numArgs = r.readUInt32BE();
      const functionArgs: ClarityValue[] = [];
      for (let i = 0; i < numArgs; i++) functionArgs.push(readCV(r));
      return { payloadType: PayloadType.ContractCall, contractAddress, contractName, functionName, functionArgs };
    }
    case PayloadType.SmartContract: {
      const contractName = readLPString(r);
      const codeBody = readLPString(r, 4);
      return { payloadType: PayloadType.SmartContract, contractName, codeBody };
    }
    case PayloadType.VersionedSmartContract: {
      const clarityVersion = r.readUInt8() as ClarityVersion;
      const contractName = readLPString(r);
      const codeBody = readLPString(r, 4);
      return { payloadType: PayloadType.VersionedSmartContract, clarityVersion, contractName, codeBody };
    }
    default:
      throw new Error(`Unknown payload type: ${payloadType}`);
  }
}

export function deserializeTransaction(input: string | Uint8Array): StacksTransaction {
  const bytes = typeof input === "string" ? hexToBytes(without0x(input)) : input;
  const r = new Reader(bytes);

  return {
    version: r.readUInt8(),
    chainId: r.readUInt32BE(),
    auth: readAuthorization(r),
    anchorMode: r.readUInt8() as AnchorMode,
    postConditionMode: r.readUInt8() as PostConditionModeWire,
    postConditions: readPostConditions(r),
    payload: readPayload(r),
  };
}
