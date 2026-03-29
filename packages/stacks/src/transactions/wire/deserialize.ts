import {
  bytesToHex,
  hexToBytes,
  bytesToAscii,
  without0x,
} from "../../utils/encoding.ts";
import { BytesReader } from "../../utils/bytes-reader.ts";
import {
  AuthType,
  PayloadType,
  AddressHashMode,
  PostConditionPrincipalId,
  AssetType,
  RECOVERABLE_ECDSA_SIG_LENGTH_BYTES,
  MEMO_MAX_LENGTH_BYTES,
  COINBASE_BYTES_LENGTH,
  VRF_PROOF_BYTES_LENGTH,
  MICROBLOCK_HEADER_BYTES_LENGTH,
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
  type TenureChangeCause,
} from "../types.ts";
import type { ClarityValue } from "../../clarity/types.ts";
import {
  readCV,
  readAddress,
  readLPString,
} from "../../clarity/deserialize.ts";

function readSpendingCondition(r: BytesReader): SpendingCondition {
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

function readAuthorization(r: BytesReader): Authorization {
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

function readAssetInfo(r: BytesReader): AssetInfoWire {
  return {
    address: readAddress(r),
    contractName: readLPString(r),
    assetName: readLPString(r),
  };
}

function readPostConditionPrincipal(r: BytesReader): PostConditionPrincipalWire {
  const type = r.readUInt8();
  switch (type) {
    case PostConditionPrincipalId.Origin:
      return { type: "origin" };
    case PostConditionPrincipalId.Standard:
      return { type: "standard", address: readAddress(r) };
    case PostConditionPrincipalId.Contract:
      return { type: "contract", address: readAddress(r), contractName: readLPString(r) };
    default:
      // Some legacy transactions may have unexpected principal types.
      // Treat as origin to allow deserialization to continue.
      return { type: "origin" };
  }
}

function readPostConditions(r: BytesReader): PostConditionWire[] {
  const count = r.readUInt32BE();
  const pcs: PostConditionWire[] = [];
  for (let i = 0; i < count; i++) {
    // Wire order: asset_type, then principal (per SIP-005 and stacks.js)
    const assetType = r.readUInt8();
    const principal = readPostConditionPrincipal(r);
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

function readPayload(r: BytesReader): TransactionPayload {
  const payloadType = r.readUInt8();

  switch (payloadType) {
    case PayloadType.TokenTransfer: {
      const recipient = readCV(r);
      const amount = r.readBigUInt64BE();
      // Memo is a flat 34-byte field (no length prefix) per SIP-005
      const memoBytes = r.readBytes(MEMO_MAX_LENGTH_BYTES);
      const memo = bytesToAscii(memoBytes).replace(/\0+$/, "");
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
    case PayloadType.Coinbase: {
      const coinbaseBuffer = bytesToHex(r.readBytes(COINBASE_BYTES_LENGTH));
      return { payloadType: PayloadType.Coinbase, coinbaseBuffer };
    }
    case PayloadType.CoinbaseToAltRecipient: {
      const coinbaseBuffer = bytesToHex(r.readBytes(COINBASE_BYTES_LENGTH));
      const recipient = readCV(r);
      return { payloadType: PayloadType.CoinbaseToAltRecipient, coinbaseBuffer, recipient };
    }
    case PayloadType.PoisonMicroblock: {
      const header1 = bytesToHex(r.readBytes(MICROBLOCK_HEADER_BYTES_LENGTH));
      const header2 = bytesToHex(r.readBytes(MICROBLOCK_HEADER_BYTES_LENGTH));
      return { payloadType: PayloadType.PoisonMicroblock, header1, header2 };
    }
    case PayloadType.TenureChange: {
      const tenureConsensusHash = bytesToHex(r.readBytes(20));
      const prevTenureConsensusHash = bytesToHex(r.readBytes(20));
      const burnViewConsensusHash = bytesToHex(r.readBytes(20));
      const previousTenureEnd = bytesToHex(r.readBytes(32));
      const previousTenureBlocks = r.readUInt32BE();
      const cause = r.readUInt8() as TenureChangeCause;
      const pubkeyHash = bytesToHex(r.readBytes(20));
      return {
        payloadType: PayloadType.TenureChange,
        tenureConsensusHash,
        prevTenureConsensusHash,
        burnViewConsensusHash,
        previousTenureEnd,
        previousTenureBlocks,
        cause,
        pubkeyHash,
      };
    }
    case PayloadType.NakamotoCoinbase: {
      const coinbaseBuffer = bytesToHex(r.readBytes(COINBASE_BYTES_LENGTH));
      const optionalCV = readCV(r);
      const recipient = optionalCV.type === "none" ? null : optionalCV.type === "some" ? optionalCV.value : optionalCV;
      const vrfProof = bytesToHex(r.readBytes(VRF_PROOF_BYTES_LENGTH));
      return { payloadType: PayloadType.NakamotoCoinbase, coinbaseBuffer, recipient, vrfProof };
    }
    default:
      throw new Error(`Unknown payload type: ${payloadType}`);
  }
}

export function deserializeTransaction(input: string | Uint8Array): StacksTransaction {
  const bytes = typeof input === "string" ? hexToBytes(without0x(input)) : input;
  const r = new BytesReader(bytes);

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
