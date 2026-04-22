import { largeOutflowKind } from "./kinds/large-outflow.ts";
import type { SentryKind } from "./types.ts";

// biome-ignore lint/suspicious/noExplicitAny: kind registry is heterogeneous.
const KINDS = new Map<string, SentryKind<any, any>>([
	[largeOutflowKind.kind, largeOutflowKind],
]);

export class UnknownSentryKindError extends Error {
	constructor(kind: string) {
		super(`unknown sentry kind: ${kind}`);
		this.name = "UnknownSentryKindError";
	}
}

// biome-ignore lint/suspicious/noExplicitAny: kind map is heterogeneous.
export function getKind(name: string): SentryKind<any, any> {
	const k = KINDS.get(name);
	if (!k) throw new UnknownSentryKindError(name);
	return k;
}

export function listKindNames(): string[] {
	return Array.from(KINDS.keys());
}
