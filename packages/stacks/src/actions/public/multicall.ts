import type { Client } from "../../clients/types.ts";
import type { ClarityValue } from "../../clarity/types.ts";
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
};

export type MulticallSuccessResult = { status: "success"; result: ClarityValue };
export type MulticallFailureResult = { status: "failure"; error: Error };

export type MulticallResult<T extends boolean> = T extends true
  ? (MulticallSuccessResult | MulticallFailureResult)[]
  : ClarityValue[];

export async function multicall<TAllowFailure extends boolean = true>(
  client: Client,
  params: MulticallParams<TAllowFailure>
): Promise<MulticallResult<TAllowFailure>> {
  const { calls, allowFailure = true } = params;

  if (allowFailure) {
    const settled = await Promise.allSettled(
      calls.map((call) => readContract(client, call))
    );
    return settled.map((r) =>
      r.status === "fulfilled"
        ? { status: "success" as const, result: r.value }
        : { status: "failure" as const, error: r.reason instanceof Error ? r.reason : new Error(String(r.reason)) }
    ) as MulticallResult<TAllowFailure>;
  }

  const results = await Promise.all(
    calls.map((call) => readContract(client, call))
  );
  return results as MulticallResult<TAllowFailure>;
}
