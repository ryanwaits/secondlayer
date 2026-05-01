import { serializeCVBytes } from "../clarity/serialize.ts";
import { bytesToHex } from "../utils/encoding.ts";
import { ConnectError, JsonRpcError } from "./errors.ts";
import { getProvider } from "./provider.ts";
import { cacheAddresses } from "./storage.ts";
import type { MethodParams, MethodResult, Methods } from "./types.ts";

const POST_CONDITION_TYPES = new Set([
	"stx-postcondition",
	"ft-postcondition",
	"nft-postcondition",
]);

function isClarityValue(obj: unknown): obj is { type: string } {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"type" in obj &&
		// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
		typeof (obj as any).type === "string" &&
		// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
		!POST_CONDITION_TYPES.has((obj as any).type)
	);
}

function serializeParams(value: unknown): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value === "bigint") return value.toString();
	if (Array.isArray(value)) return value.map(serializeParams);

	if (typeof value === "object") {
		if (value instanceof Uint8Array) return value;

		// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
		if (POST_CONDITION_TYPES.has((value as any).type)) return value;

		if (isClarityValue(value)) {
			// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
			return bytesToHex(serializeCVBytes(value as any));
		}

		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			result[k] = serializeParams(v);
		}
		return result;
	}

	return value;
}

const ADDRESS_METHODS = new Set(["getAddresses", "stx_getAddresses"]);

export async function request<M extends keyof Methods>(
	method: M,
	...args: MethodParams<M> extends undefined ? [] : [params: MethodParams<M>]
): Promise<MethodResult<M>> {
	const provider = getProvider();

	const params = args[0];
	const serialized = params ? serializeParams(params) : undefined;

	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	let result: any;
	try {
		result = await provider.request(method as string, serialized);
		// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	} catch (err: any) {
		if (err?.code !== undefined) {
			throw new JsonRpcError(err.message ?? String(err), err.code, {
				data: err.data,
			});
		}
		throw new ConnectError(err?.message ?? "Wallet request failed", {
			cause: err instanceof Error ? err : undefined,
		});
	}

	if (ADDRESS_METHODS.has(method as string) && result?.addresses) {
		cacheAddresses(result.addresses);
	}

	return result as MethodResult<M>;
}
