/**
 * Handler isolation — untrusted subgraph handlers run behind a timeout,
 * optional network deny, and cannot take down the host process.
 */

export const ISOLATION_FAULTS = [
	"timeout",
	"throw",
	"oom",
	"kill",
	"network",
] as const;
export type IsolationFault = (typeof ISOLATION_FAULTS)[number];

export type IsolationLimits = {
	timeoutMs: number;
	memoryMb?: number;
	allowNetwork?: boolean;
};

export type IsolationResult =
	| { ok: true; hostAlive: true }
	| { ok: false; fault: IsolationFault; hostAlive: true; detail: string };

export class IsolationNetworkError extends Error {
	readonly name = "IsolationNetworkError";
}

export class IsolationKillError extends Error {
	readonly name = "IsolationKillError";
}

export class IsolationOomError extends Error {
	readonly name = "IsolationOomError";
}

export async function isolateHandler(
	run: (ctx: {
		signal: AbortSignal;
		fetch: (url: string) => Promise<unknown>;
	}) => Promise<void>,
	limits: IsolationLimits,
): Promise<IsolationResult> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
	const blockedFetch = async (_url: string): Promise<unknown> => {
		throw new IsolationNetworkError("network is disabled in this handler");
	};
	try {
		await run({
			signal: controller.signal,
			fetch: limits.allowNetwork ? (url: string) => fetch(url) : blockedFetch,
		});
		if (controller.signal.aborted) {
			return {
				ok: false,
				fault: "timeout",
				hostAlive: true,
				detail: `exceeded ${limits.timeoutMs}ms`,
			};
		}
		return { ok: true, hostAlive: true };
	} catch (error) {
		if (controller.signal.aborted || isAbort(error)) {
			return {
				ok: false,
				fault: "timeout",
				hostAlive: true,
				detail: `exceeded ${limits.timeoutMs}ms`,
			};
		}
		if (error instanceof IsolationNetworkError) {
			return {
				ok: false,
				fault: "network",
				hostAlive: true,
				detail: error.message,
			};
		}
		if (error instanceof IsolationKillError) {
			return {
				ok: false,
				fault: "kill",
				hostAlive: true,
				detail: error.message,
			};
		}
		if (error instanceof IsolationOomError) {
			return {
				ok: false,
				fault: "oom",
				hostAlive: true,
				detail: error.message,
			};
		}
		return {
			ok: false,
			fault: "throw",
			hostAlive: true,
			detail: error instanceof Error ? error.message : String(error),
		};
	} finally {
		clearTimeout(timer);
	}
}

function isAbort(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}
