import {
  bytesToHex,
  hexToBytes,
  concatBytes,
  bigIntToBytes,
  toTwos,
  asciiToBytes,
  utf8ToBytes,
  writeUInt32BE,
  intToHex,
} from "../utils/encoding.ts";
import { c32addressDecode } from "c32check";
import { ClarityWireType, type ClarityValue, type ClarityType } from "./types.ts";

const CLARITY_INT_SIZE = 128n;
const CLARITY_INT_BYTE_SIZE = 16;

function typeIdByte(type: ClarityType): number {
  return ClarityWireType[type];
}

function withTypeId(type: ClarityType, bytes: Uint8Array): Uint8Array {
  return concatBytes(new Uint8Array([typeIdByte(type)]), bytes);
}

function serializeAddress(c32Address: string): Uint8Array {
  const [version, hash160] = c32addressDecode(c32Address);
  return concatBytes(new Uint8Array([version]), hexToBytes(hash160));
}

function serializeLPString(str: string, prefixBytes = 1): Uint8Array {
  const content = utf8ToBytes(str);
  const lengthPrefix = hexToBytes(intToHex(content.byteLength, prefixBytes));
  return concatBytes(lengthPrefix, content);
}

export function serializeCVBytes(value: ClarityValue): Uint8Array {
  switch (value.type) {
    case "true":
    case "false":
      return new Uint8Array([typeIdByte(value.type)]);

    case "int": {
      const bytes = bigIntToBytes(
        toTwos(BigInt(value.value), CLARITY_INT_SIZE),
        CLARITY_INT_BYTE_SIZE
      );
      return withTypeId(value.type, bytes);
    }

    case "uint": {
      const bytes = bigIntToBytes(BigInt(value.value), CLARITY_INT_BYTE_SIZE);
      return withTypeId(value.type, bytes);
    }

    case "buffer": {
      const bufBytes = hexToBytes(value.value);
      return withTypeId(
        value.type,
        concatBytes(writeUInt32BE(bufBytes.length), bufBytes)
      );
    }

    case "none":
      return new Uint8Array([typeIdByte(value.type)]);

    case "some":
      return withTypeId(value.type, serializeCVBytes(value.value));

    case "ok":
    case "err":
      return withTypeId(value.type, serializeCVBytes(value.value));

    case "address":
      return withTypeId(value.type, serializeAddress(value.value));

    case "contract": {
      const [addr, name] = value.value.split(".");
      if (!addr || !name) throw new Error(`Invalid contract principal: ${value.value}`);
      return withTypeId(
        value.type,
        concatBytes(serializeAddress(addr), serializeLPString(name))
      );
    }

    case "list": {
      const parts: Uint8Array[] = [writeUInt32BE(value.value.length)];
      for (const item of value.value) {
        parts.push(serializeCVBytes(item));
      }
      return withTypeId(value.type, concatBytes(...parts));
    }

    case "tuple": {
      const keys = Object.keys(value.value).sort((a, b) => a.localeCompare(b));
      const parts: Uint8Array[] = [writeUInt32BE(keys.length)];
      for (const key of keys) {
        parts.push(serializeLPString(key));
        parts.push(serializeCVBytes(value.value[key]!));
      }
      return withTypeId(value.type, concatBytes(...parts));
    }

    case "ascii": {
      const strBytes = asciiToBytes(value.value);
      return withTypeId(
        value.type,
        concatBytes(writeUInt32BE(strBytes.length), strBytes)
      );
    }

    case "utf8": {
      const strBytes = utf8ToBytes(value.value);
      return withTypeId(
        value.type,
        concatBytes(writeUInt32BE(strBytes.length), strBytes)
      );
    }

    default:
      throw new Error(`Cannot serialize unknown clarity type`);
  }
}

export function serializeCV(value: ClarityValue): string {
  return bytesToHex(serializeCVBytes(value));
}
