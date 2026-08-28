import type { ClarityValue } from "../../clarity/types.ts";
import type { Client } from "../../clients/types.ts";
import { readContract } from "./readContract.ts";

export type MulticallCall = {
	contract: string;
	functionName: string;
	args?: ClarityValue[];
	sender?: string;
};

export type MulticallParams<TAllowFailure extends boolean = true> = {
	calls: readonly MulticallCall[];
	allowFailure?: TAllowFailure;
	/**
	 * Reads in flight at once. Default 8. Each call is its own
	 * `/v2/contracts/call-read` request (Stacks nodes have no batch RPC), so
	 * an uncapped fan-out turns one multicall into a burst that trips rate
	 * limits and then retries in lockstep.
	 */
	concurrency?: number;
};

export type MulticallSuccessResult = {
	status: "success";
	result: ClarityValue;
};
export type MulticallFailureResult = { status: "failure"; error: Error };

export type MulticallResult<T extends boolean> = T extends true
	? (MulticallSuccessResult | MulticallFailureResult)[]
	: ClarityValue[];

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
	const results: PromiseSettledResult<R>[] = new Array(items.length);
	let cursor = 0;
	const worker = async () => {
		while (cursor < items.length) {
			const index = cursor++;
			try {
				results[index] = {
					status: "fulfilled",
					value: await fn(items[index] as T),
				};
			} catch (reason) {
				results[index] = { status: "rejected", reason };
			}
		}
	};
	const workers = Math.max(1, Math.min(limit, items.length));
	await Promise.all(Array.from({ length: workers }, worker));
	return results;
}

export async function multicall<TAllowFailure extends boolean = true>(
	client: Client,
	params: MulticallParams<TAllowFailure>,
): Promise<MulticallResult<TAllowFailure>> {
	const { calls, allowFailure = true, concurrency = 8 } = params;
	if (!Number.isInteger(concurrency) || concurrency < 1) {
		throw new RangeError(
			`multicall concurrency must be a positive integer, got ${concurrency}`,
		);
	}

	const settled = await mapWithConcurrency(calls, concurrency, (call) =>
		readContract(client, call),
	);

	if (allowFailure) {
		return settled.map((r) =>
			r.status === "fulfilled"
				? { status: "success" as const, result: r.value }
				: {
						status: "failure" as const,
						error:
							r.reason instanceof Error
								? r.reason
								: new Error(String(r.reason)),
					},
		) as MulticallResult<TAllowFailure>;
	}

	const results: ClarityValue[] = [];
	for (const r of settled) {
		if (r.status === "rejected") throw r.reason;
		results.push(r.value);
	}
	return results as MulticallResult<TAllowFailure>;
}
