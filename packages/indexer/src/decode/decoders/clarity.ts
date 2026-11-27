import { cvToValue, deserializeCV } from "@secondlayer/stacks/clarity";

export function decodeClarityPayload(
	payload: Record<string, unknown>,
): unknown {
	if (typeof payload.raw_value === "string") {
		return decodeClarityHex(payload.raw_value);
	}
	const value = payload.value;
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const v = value as Record<string, unknown>;
		if (typeof v.hex === "string") return decodeClarityHex(v.hex);
		return v;
	}
	if (typeof value === "string") return decodeClarityHex(value);
	return null;
}

function decodeClarityHex(hex: string): unknown {
	const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
	return cvToValue(deserializeCV(cleanHex));
}
