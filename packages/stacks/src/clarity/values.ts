import { c32address, c32addressDecode } from "../utils/c32.ts";
import {
  bytesToHex,
  hexToBytes,
  asciiToBytes,
  utf8ToBytes,
  intToBigInt,
  bytesToTwosBigInt,
  type IntegerType,
} from "../utils/encoding.ts";
import { isClarityName } from "../utils/address.ts";
import type {
  IntCV,
  UIntCV,
  BooleanCV,
  TrueCV,
  FalseCV,
  BufferCV,
  NoneCV,
  SomeCV,
  OptionalCV,
  ResponseOkCV,
  ResponseErrorCV,
  StandardPrincipalCV,
  ContractPrincipalCV,
  ListCV,
  TupleCV,
  TupleData,
  StringAsciiCV,
  StringUtf8CV,
  ClarityValue,
} from "./types.ts";
import { serializeCVBytes } from "./serialize.ts";
import { deserializeCVBytes } from "./deserialize.ts";

const MAX_U128 = BigInt("0xffffffffffffffffffffffffffffffff");
const MIN_I128 = BigInt("-170141183460469231731687303715884105728");
const MAX_I128 = BigInt("0x7fffffffffffffffffffffffffffffff");

// Primitives

export function intCV(value: IntegerType): IntCV {
  if (typeof value === "string" && value.toLowerCase().startsWith("0x")) {
    value = bytesToTwosBigInt(hexToBytes(value));
  }
  if (value instanceof Uint8Array) value = bytesToTwosBigInt(value);
  const n = intToBigInt(value);
  if (n > MAX_I128) throw new RangeError(`Int exceeds max i128: ${MAX_I128}`);
  if (n < MIN_I128) throw new RangeError(`Int below min i128: ${MIN_I128}`);
  return { type: "int", value: n };
}

export function uintCV(value: IntegerType): UIntCV {
  const n = intToBigInt(value);
  if (n < 0n) throw new RangeError("Cannot construct unsigned int from negative value");
  if (n > MAX_U128) throw new RangeError(`UInt exceeds max u128: ${MAX_U128}`);
  return { type: "uint", value: n };
}

export const trueCV = (): TrueCV => ({ type: "true" });
export const falseCV = (): FalseCV => ({ type: "false" });
export const boolCV = (v: boolean): BooleanCV => (v ? trueCV() : falseCV());

export function bufferCV(buffer: Uint8Array): BufferCV {
  if (buffer.byteLength > 1_048_576) {
    throw new Error("Buffer exceeds max size of 1MB");
  }
  return { type: "buffer", value: bytesToHex(buffer) };
}

export function standardPrincipalCV(address: string): StandardPrincipalCV {
  // Validate by decoding
  const [version, hash160] = c32addressDecode(address);
  const normalized = c32address(version, hash160);
  return { type: "address", value: normalized };
}

export function contractPrincipalCV(
  address: string,
  contractName: string
): ContractPrincipalCV {
  const [version, hash160] = c32addressDecode(address);
  const normalized = c32address(version, hash160);
  if (utf8ToBytes(contractName).byteLength >= 128) {
    throw new Error("Contract name must be less than 128 bytes");
  }
  return { type: "contract", value: `${normalized}.${contractName}` };
}

export function noneCV(): NoneCV {
  return { type: "none" };
}

export function someCV(value: ClarityValue): SomeCV {
  return { type: "some", value };
}

export function responseOkCV(value: ClarityValue): ResponseOkCV {
  return { type: "ok", value };
}

export function responseErrorCV(value: ClarityValue): ResponseErrorCV {
  return { type: "err", value };
}

export function listCV(values: ClarityValue[]): ListCV {
  return { type: "list", value: values };
}

export function tupleCV(data: TupleData): TupleCV {
  for (const key in data) {
    if (!isClarityName(key)) {
      throw new Error(`"${key}" is not a valid Clarity name`);
    }
  }
  return { type: "tuple", value: data };
}

export function stringAsciiCV(value: string): StringAsciiCV {
  return { type: "ascii", value };
}

export function stringUtf8CV(value: string): StringUtf8CV {
  return { type: "utf8", value };
}

// Cl namespace — clean API

export const Cl = {
  int: intCV,
  uint: uintCV,
  bool: boolCV,
  principal(address: string): StandardPrincipalCV | ContractPrincipalCV {
    const [addr, name] = address.split(".");
    if (!addr) throw new Error("Invalid principal address");
    return name ? contractPrincipalCV(addr, name) : standardPrincipalCV(addr);
  },
  address(address: string) {
    return Cl.principal(address);
  },
  contractPrincipal: contractPrincipalCV,
  standardPrincipal: standardPrincipalCV,
  buffer: bufferCV,
  bufferFromHex: (hex: string) => bufferCV(hexToBytes(hex)),
  bufferFromAscii: (ascii: string) => bufferCV(asciiToBytes(ascii)),
  bufferFromUtf8: (utf8: string) => bufferCV(utf8ToBytes(utf8)),
  none: noneCV,
  some: someCV,
  ok: responseOkCV,
  error: responseErrorCV,
  list: listCV,
  tuple: tupleCV,
  stringAscii: stringAsciiCV,
  stringUtf8: stringUtf8CV,
  serialize(value: ClarityValue): string {
    return bytesToHex(serializeCVBytes(value));
  },
  deserialize: deserializeCVBytes,
} as const;
