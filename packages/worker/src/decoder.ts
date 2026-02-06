import { cvToJSON, deserializeCV } from "@secondlayer/stacks/clarity";

/**
 * Decode a hex-encoded Clarity value to a JavaScript object
 * Uses cvToJSON from @secondlayer/stacks for reliable decoding
 */
export function decodeClarityValue(hex: string): any {
  try {
    // Remove 0x prefix if present
    const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
    const cv = deserializeCV(cleanHex);
    return cvToJSON(cv);
  } catch {
    // Return original hex if decoding fails
    return hex;
  }
}

/**
 * Decode a transaction result (hex-encoded Clarity value)
 */
export function decodeTransactionResult(rawResult: string): any {
  return decodeClarityValue(rawResult);
}

/**
 * Decode an array of function arguments (hex-encoded Clarity values)
 */
export function decodeFunctionArgs(args: string[]): any[] {
  return args.map(decodeClarityValue);
}

/**
 * Try to decode event data, falling back to original if decoding fails
 */
export function decodeEventData(data: any): any {
  if (typeof data === "string" && data.startsWith("0x")) {
    return decodeClarityValue(data);
  }

  if (typeof data === "object" && data !== null) {
    const decoded: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string" && value.startsWith("0x") && value.length > 10) {
        // Likely a hex-encoded Clarity value
        decoded[key] = decodeClarityValue(value);
      } else {
        decoded[key] = value;
      }
    }
    return decoded;
  }

  return data;
}
