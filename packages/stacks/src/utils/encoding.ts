const hexes = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) {
    hex += hexes[b];
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  hex = without0x(hex);
  if (hex.length % 2) hex = `0${hex}`;

  const array = new Uint8Array(hex.length / 2);
  for (let i = 0; i < array.length; i++) {
    const j = i * 2;
    const byte = Number.parseInt(hex.slice(j, j + 2), 16);
    if (Number.isNaN(byte) || byte < 0) throw new Error("Invalid byte sequence");
    array[i] = byte;
  }
  return array;
}

export function with0x(value: string): string {
  return /^0x/i.test(value) ? value : `0x${value}`;
}

export function without0x(value: string): string {
  return /^0x/i.test(value) ? value.slice(2) : value;
}

export function utf8ToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function asciiToBytes(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  return bytes;
}

export function bytesToAscii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  if (arrays.length === 1) return arrays[0]!;
  const length = arrays.reduce((a, arr) => a + arr.length, 0);
  const result = new Uint8Array(length);
  let pad = 0;
  for (const arr of arrays) {
    result.set(arr, pad);
    pad += arr.length;
  }
  return result;
}

export type IntegerType = number | string | bigint | Uint8Array;

export function intToBigInt(value: IntegerType): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "string") return BigInt(value);
  if (typeof value === "number") {
    if (!Number.isInteger(value))
      throw new RangeError("Values of type 'number' must be an integer.");
    if (value > Number.MAX_SAFE_INTEGER)
      throw new RangeError(
        `Values of type 'number' must be <= ${Number.MAX_SAFE_INTEGER}. Use BigInt instead.`
      );
    return BigInt(value);
  }
  if (value instanceof Uint8Array) return BigInt(`0x${bytesToHex(value)}`);
  throw new TypeError("Must be a number, bigint, string, or Uint8Array.");
}

export function intToBytes(value: IntegerType, byteLength: number): Uint8Array {
  return bigIntToBytes(intToBigInt(value), byteLength);
}

export function bigIntToBytes(value: bigint, length: number = 16): Uint8Array {
  const hex = value.toString(16).padStart(length * 2, "0");
  return hexToBytes(hex);
}

export function intToHex(integer: IntegerType, byteLength = 8): string {
  const value = typeof integer === "bigint" ? integer : intToBigInt(integer);
  return value.toString(16).padStart(byteLength * 2, "0");
}

export function hexToInt(hex: string): number {
  return parseInt(hex, 16);
}

export function toTwos(value: bigint, width: bigint): bigint {
  const limit = BigInt(1) << (width - BigInt(1));
  if (value < -limit || value > limit - BigInt(1)) {
    throw new Error(`Unable to represent integer in width: ${width}`);
  }
  if (value >= BigInt(0)) return value;
  return value + (BigInt(1) << width);
}

export function fromTwos(value: bigint, width: bigint): bigint {
  if (value & (BigInt(1) << (width - BigInt(1)))) {
    return value - (BigInt(1) << width);
  }
  return value;
}

export function bytesToTwosBigInt(bytes: Uint8Array): bigint {
  return fromTwos(BigInt(`0x${bytesToHex(bytes)}`), BigInt(bytes.byteLength * 8));
}

export function writeUInt32BE(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = (value >>> 24) & 0xff;
  buf[1] = (value >>> 16) & 0xff;
  buf[2] = (value >>> 8) & 0xff;
  buf[3] = value & 0xff;
  return buf;
}

export function readUInt32BE(bytes: Uint8Array, offset = 0): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

export function writeUInt16BE(value: number): Uint8Array {
  const buf = new Uint8Array(2);
  buf[0] = (value >>> 8) & 0xff;
  buf[1] = value & 0xff;
  return buf;
}

export function readUInt16BE(bytes: Uint8Array, offset = 0): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0;
}

export function writeUInt8(value: number): Uint8Array {
  return new Uint8Array([value & 0xff]);
}
