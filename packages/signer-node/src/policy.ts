import type { SignRequest } from "./types.ts";

/**
 * Signer policy hooks. Every hook runs *before* the private key touches the
 * request. Return `{ approve: true }` to proceed, or `{ approve: false,
 * reason }` to refuse — the runner surfaces the reason as a
 * `TxSignerRefusedError` in the workflow run.
 *
 * Policies compose: the first hook that refuses short-circuits.
 *
 * @example
 *   const policy = composePolicies(
 *     allowlistFunctions({
 *       "SP123.dex-swap-v2": ["swap-usdc-for-stx"],
 *     }),
 *     dailyCapMicroStx(1_000_000_000n),
 *     requireApproval({ webhook: process.env.APPROVAL_WEBHOOK! }),
 *   )
 */

export type PolicyDecision =
	| { approve: true }
	| { approve: false; reason: string };

export type Policy = (request: SignRequest) => Promise<PolicyDecision>;

/**
 * Compose multiple policies sequentially. First refusal wins; if all approve,
 * the request proceeds.
 */
export function composePolicies(...policies: Policy[]): Policy {
	return async (request) => {
		for (const p of policies) {
			const decision = await p(request);
			if (!decision.approve) return decision;
		}
		return { approve: true };
	};
}

/**
 * Only allow contract calls to `{contract: [fn1, fn2, ...]}`. Transfers and
 * other kinds are always refused by this policy — compose with a separate
 * transfer-allowlist if you want both.
 */
export function allowlistFunctions(
	allow: Record<string, readonly string[]>,
): Policy {
	return async (request) => {
		if (request.tx.kind !== "contract-call") {
			return {
				approve: false,
				reason: `allowlistFunctions: tx kind "${request.tx.kind}" not in allowlist`,
			};
		}
		const { contract, functionName } = request.tx;
		if (!contract || !functionName) {
			return {
				approve: false,
				reason: "allowlistFunctions: missing contract or functionName",
			};
		}
		const fns = allow[contract];
		if (!fns || !fns.includes(functionName)) {
			return {
				approve: false,
				reason: `allowlistFunctions: ${contract}.${functionName} not allowed`,
			};
		}
		return { approve: true };
	};
}

interface DailyCapState {
	dateKey: string;
	spentMicroStx: bigint;
}

/**
 * Reject requests whose cumulative daily µSTX spend would exceed `cap`.
 * Resets at the start of each UTC day. In-memory only — restart clears
 * the window. For durable quotas, implement your own policy backed by a DB.
 */
export function dailyCapMicroStx(cap: bigint): Policy {
	const state: DailyCapState = { dateKey: "", spentMicroStx: 0n };
	return async (request) => {
		const today = request.issuedAt.slice(0, 10);
		if (state.dateKey !== today) {
			state.dateKey = today;
			state.spentMicroStx = 0n;
		}
		const amount = BigInt(request.tx.amount ?? "0");
		const next = state.spentMicroStx + amount;
		if (next > cap) {
			return {
				approve: false,
				reason: `dailyCapMicroStx: ${next}µSTX would exceed ${cap}µSTX for ${today}`,
			};
		}
		state.spentMicroStx = next;
		return { approve: true };
	};
}

/**
 * Delegate approval to a human-in-the-loop webhook. The webhook receives
 * the full `SignRequest` and must return `{ approved: true }` or `{
 * approved: false, reason }` within `timeoutMs`.
 */
export function requireApproval(opts: {
	webhook: string;
	timeoutMs?: number;
}): Policy {
	const timeout = opts.timeoutMs ?? 60_000;
	return async (request) => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeout);
		try {
			const res = await fetch(opts.webhook, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(request),
				signal: controller.signal,
			});
			if (!res.ok) {
				return {
					approve: false,
					reason: `requireApproval: webhook returned ${res.status}`,
				};
			}
			const decision = (await res.json()) as {
				approved: boolean;
				reason?: string;
			};
			return decision.approved
				? { approve: true }
				: {
						approve: false,
						reason: decision.reason ?? "requireApproval: rejected by reviewer",
					};
		} catch (err) {
			return {
				approve: false,
				reason: `requireApproval: ${err instanceof Error ? err.message : String(err)}`,
			};
		} finally {
			clearTimeout(timer);
		}
	};
}

/** Default-deny: use as the base policy if the composed list is empty. */
export const denyAll: Policy = async () => ({
	approve: false,
	reason: "default-deny: no policies approved this request",
});
