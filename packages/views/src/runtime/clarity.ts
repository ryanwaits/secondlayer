import { cvToJSON, hexToCV } from "@stacks/transactions";

/**
 * Decode a hex-encoded Clarity value to a JS object.
 * Returns original value on failure.
 */
export function decodeClarityValue(hex: string): unknown {
  try {
    const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
    const cv = hexToCV(cleanHex);
    return cvToJSON(cv);
  } catch {
    return hex;
  }
}

/**
 * Recursively decode all hex-encoded Clarity values in an object.
 * Any string starting with "0x" and longer than 10 chars is attempted.
 */
export function decodeEventData(data: unknown): unknown {
  if (typeof data === "string" && data.startsWith("0x") && data.length > 10) {
    return decodeClarityValue(data);
  }

  if (Array.isArray(data)) {
    return data.map(decodeEventData);
  }

  if (typeof data === "object" && data !== null) {
    const decoded: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      decoded[key] = decodeEventData(value);
    }
    return decoded;
  }

  return data;
}

/**
 * Decode function args array (hex-encoded Clarity values).
 */
export function decodeFunctionArgs(args: string[]): unknown[] {
  return args.map(decodeClarityValue);
}
