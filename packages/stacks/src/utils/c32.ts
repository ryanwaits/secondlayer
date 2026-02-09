import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "./encoding.ts";

const C32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const HEX = "0123456789abcdef";

function c32normalize(input: string): string {
  return input.toUpperCase().replace(/O/g, "0").replace(/L|I/g, "1");
}

function c32encode(inputHex: string): string {
  if (inputHex.length % 2 !== 0) inputHex = `0${inputHex}`;
  inputHex = inputHex.toLowerCase();

  const res: string[] = [];
  let carry = 0;
  for (let i = inputHex.length - 1; i >= 0; i--) {
    if (carry < 4) {
      const currentCode = HEX.indexOf(inputHex[i]!) >> carry;
      const nextCode = i !== 0 ? HEX.indexOf(inputHex[i - 1]!) : 0;
      const nextBits = 1 + carry;
      const nextLowBits = (nextCode % (1 << nextBits)) << (5 - nextBits);
      res.unshift(C32[currentCode + nextLowBits]!);
      carry = nextBits;
    } else {
      carry = 0;
    }
  }

  // Strip leading c32 zeros
  let leadingZeros = 0;
  while (leadingZeros < res.length && res[leadingZeros] === "0") leadingZeros++;
  const stripped = res.slice(leadingZeros);

  // Preserve leading zero bytes from hex
  const bytes = hexToBytes(inputHex);
  let zeroBytesCount = 0;
  while (zeroBytesCount < bytes.length && bytes[zeroBytesCount] === 0) zeroBytesCount++;
  const prefix = Array(zeroBytesCount).fill(C32[0]) as string[];

  return [...prefix, ...stripped].join("");
}

function c32decode(c32input: string): string {
  c32input = c32normalize(c32input);
  if (!c32input.match(`^[${C32}]*$`)) throw new Error("Not a c32-encoded string");

  const zeroPrefix = c32input.match(`^${C32[0]}*`);
  const numLeadingZeroBytes = zeroPrefix ? zeroPrefix[0]!.length : 0;

  const res: string[] = [];
  let carry = 0;
  let carryBits = 0;
  for (let i = c32input.length - 1; i >= 0; i--) {
    if (carryBits === 4) {
      res.unshift(HEX[carry]!);
      carryBits = 0;
      carry = 0;
    }
    const currentValue = (C32.indexOf(c32input[i]!) << carryBits) + carry;
    res.unshift(HEX[currentValue % 16]!);
    carryBits += 1;
    carry = currentValue >> 4;
    if (carry > 1 << carryBits) throw new Error("Panic error in c32 decoding");
  }
  res.unshift(HEX[carry]!);

  if (res.length % 2 === 1) res.unshift("0");

  // Strip leading hex zeros
  let hexLeadingZeros = 0;
  while (hexLeadingZeros < res.length && res[hexLeadingZeros] === "0") hexLeadingZeros++;
  let hexStr = res.slice(hexLeadingZeros - (hexLeadingZeros % 2)).join("");

  for (let i = 0; i < numLeadingZeroBytes; i++) hexStr = `00${hexStr}`;

  return hexStr;
}

function c32checksum(dataHex: string): string {
  return bytesToHex(sha256(sha256(hexToBytes(dataHex))).slice(0, 4));
}

function c32checkEncode(version: number, data: string): string {
  if (version < 0 || version >= 32) throw new Error("Invalid version (must be between 0 and 31)");
  if (!data.match(/^[0-9a-fA-F]*$/)) throw new Error("Invalid data (not a hex string)");

  data = data.toLowerCase();
  if (data.length % 2 !== 0) data = `0${data}`;

  let versionHex = version.toString(16);
  if (versionHex.length === 1) versionHex = `0${versionHex}`;

  const checksumHex = c32checksum(`${versionHex}${data}`);
  return `${C32[version]}${c32encode(`${data}${checksumHex}`)}`;
}

function c32checkDecode(c32data: string): [number, string] {
  c32data = c32normalize(c32data);
  const dataHex = c32decode(c32data.slice(1));
  const version = C32.indexOf(c32data[0]!);
  const checksum = dataHex.slice(-8);

  let versionHex = version.toString(16);
  if (versionHex.length === 1) versionHex = `0${versionHex}`;

  if (c32checksum(`${versionHex}${dataHex.substring(0, dataHex.length - 8)}`) !== checksum) {
    throw new Error("Invalid c32check string: checksum mismatch");
  }

  return [version, dataHex.substring(0, dataHex.length - 8)];
}

export function c32address(version: number, hash160hex: string): string {
  if (!hash160hex.match(/^[0-9a-fA-F]{40}$/)) {
    throw new Error("Invalid argument: not a hash160 hex string");
  }
  return `S${c32checkEncode(version, hash160hex)}`;
}

export function c32addressDecode(c32addr: string): [number, string] {
  if (c32addr.length <= 5) throw new Error("Invalid c32 address: invalid length");
  if (c32addr[0] !== "S") throw new Error('Invalid c32 address: must start with "S"');
  return c32checkDecode(c32addr.slice(1));
}
