import {
  hexToBytes,
  bytesToHex,
  bytesToAscii,
  bytesToUtf8,
  bytesToTwosBigInt,
  without0x,
} from "../utils/encoding.ts";
import { c32address } from "../utils/c32.ts";
import {
  clarityTypeFromByte,
  type ClarityValue,
} from "./types.ts";
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
} from "./values.ts";

class BytesReader {
  private data: Uint8Array;
  private offset = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  readUInt8(): number {
    const value = this.data[this.offset]!;
    this.offset += 1;
    return value;
  }

  readUInt32BE(): number {
    const value =
      ((this.data[this.offset]! << 24) |
        (this.data[this.offset + 1]! << 16) |
        (this.data[this.offset + 2]! << 8) |
        this.data[this.offset + 3]!) >>>
      0;
    this.offset += 4;
    return value;
  }

  readBytes(length: number): Uint8Array {
    const slice = this.data.slice(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }
}

function readAddress(reader: BytesReader): string {
  const version = reader.readUInt8();
  const hash160 = bytesToHex(reader.readBytes(20));
  return c32address(version, hash160);
}

function readLPString(reader: BytesReader, prefixBytes = 1): string {
  let length = 0;
  for (let i = 0; i < prefixBytes; i++) {
    length = (length << 8) | reader.readUInt8();
  }
  return bytesToUtf8(reader.readBytes(length));
}

function readCV(reader: BytesReader): ClarityValue {
  const typeByte = reader.readUInt8();
  const type = clarityTypeFromByte(typeByte);

  switch (type) {
    case "int":
      return intCV(bytesToTwosBigInt(reader.readBytes(16)));

    case "uint":
      return uintCV(reader.readBytes(16));

    case "true":
      return trueCV();

    case "false":
      return falseCV();

    case "buffer": {
      const len = reader.readUInt32BE();
      return bufferCV(reader.readBytes(len));
    }

    case "none":
      return noneCV();

    case "some":
      return someCV(readCV(reader));

    case "ok":
      return responseOkCV(readCV(reader));

    case "err":
      return responseErrorCV(readCV(reader));

    case "address":
      return standardPrincipalCV(readAddress(reader));

    case "contract": {
      const addr = readAddress(reader);
      const name = readLPString(reader);
      return contractPrincipalCV(addr, name);
    }

    case "list": {
      const len = reader.readUInt32BE();
      const items: ClarityValue[] = [];
      for (let i = 0; i < len; i++) {
        items.push(readCV(reader));
      }
      return listCV(items);
    }

    case "tuple": {
      const len = reader.readUInt32BE();
      const data: Record<string, ClarityValue> = {};
      for (let i = 0; i < len; i++) {
        const key = readLPString(reader);
        data[key] = readCV(reader);
      }
      return tupleCV(data);
    }

    case "ascii": {
      const len = reader.readUInt32BE();
      return stringAsciiCV(bytesToAscii(reader.readBytes(len)));
    }

    case "utf8": {
      const len = reader.readUInt32BE();
      return stringUtf8CV(bytesToUtf8(reader.readBytes(len)));
    }

    default:
      throw new Error(`Cannot deserialize unknown clarity type: ${type}`);
  }
}

export function deserializeCVBytes<T extends ClarityValue = ClarityValue>(
  input: Uint8Array | string
): T {
  const bytes =
    typeof input === "string" ? hexToBytes(without0x(input)) : input;
  return readCV(new BytesReader(bytes)) as T;
}

export function deserializeCV<T extends ClarityValue = ClarityValue>(
  input: Uint8Array | string
): T {
  return deserializeCVBytes(input);
}
