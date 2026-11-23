import type { WebhooksResult } from "./dashboard-results";
import type { ServiceState, StackState } from "./usage";

/**
 * Pure on purpose: it is built from what the API returns today (the billing
 * `service.state` and the kind a dashboard read ended in), so changing where
 * the platform reports stack state only changes these inputs.
 */
export type StackStatus =
	| "none"
	| "running"
	| "starting"
	| "asleep"
	| "waking"
	| "stopped_no_credits"
	| "stopped_other";

export type StackRead = Pick<WebhooksResult<unknown>, "kind"> | null;

export interface StackInputs {
	service: ServiceState | null;
	/** Wins over `service` when present; an API that predates it leaves it out. */
	stack?: StackState | null;
	read: StackRead;
	creditsUsdMicros: string | null;
	waking?: boolean;
}

export function stackStatus({
	service,
	stack,
	read,
	creditsUsdMicros,
	waking = false,
}: StackInputs): StackStatus | null {
	// A read is fresher than the hourly billing state, so it wins.
	if (read?.kind === "asleep") return waking ? "waking" : "asleep";
	if (read?.kind === "starting") return "starting";
	if (read?.kind === "no_credits") return "stopped_no_credits";
	if (stack) {
		switch (stack) {
			case "none":
				return "none";
			case "provisioning":
				return "starting";
			case "running":
				return "running";
			case "stopped_credits":
				return "stopped_no_credits";
			case "stopped_cap":
				return "stopped_other";
			case "stopped_idle":
				return waking ? "waking" : "asleep";
		}
	}
	if (service === null) return null;
	if (service === "none") return "none";
	if (service === "running") return "running";
	if (creditsUsdMicros !== null && Number(creditsUsdMicros) <= 0) {
		return "stopped_no_credits";
	}
	// Credits are there and a read got through: the stack restarts itself.
	// With no read to go on, or credits still loading, say only that it's stopped.
	return read !== null && creditsUsdMicros !== null
		? "starting"
		: "stopped_other";
}

export function isStopped(status: StackStatus | null): boolean {
	return status === "stopped_no_credits" || status === "stopped_other";
}

export type StackNotice =
	| { kind: "starting" }
	| { kind: "asleep" }
	| { kind: "no_credits" }
	| { kind: "error"; message: string };

/**
 * `not_found` is no notice: a list that 404s is empty, and a detail page owns
 * its own not-found view.
 */
export function noticeFor(
	res: WebhooksResult<unknown>,
): StackNotice | null | undefined {
	switch (res.kind) {
		case "ok":
		case "not_found":
			return null;
		case "rate_limited":
			return undefined;
		case "starting":
		case "asleep":
		case "no_credits":
			return { kind: res.kind };
		case "error":
			return { kind: "error", message: res.message };
	}
}

export const WAKE_TIMEOUT_MS = 30_000;

export type WakeState =
	| { phase: "idle" }
	| { phase: "waking"; since: number }
	| { phase: "failed"; message: string };

export type WakeEvent =
	| { type: "start"; now: number }
	| { type: "error"; message: string }
	| { type: "tick"; now: number };

export const WAKE_IDLE: WakeState = { phase: "idle" };

export function wakeReducer(state: WakeState, event: WakeEvent): WakeState {
	switch (event.type) {
		case "start":
			return state.phase === "waking"
				? state
				: { phase: "waking", since: event.now };
		case "error":
			return state.phase === "waking"
				? { phase: "failed", message: event.message }
				: state;
		case "tick":
			return state.phase === "waking" &&
				event.now - state.since >= WAKE_TIMEOUT_MS
				? {
						phase: "failed",
						message: "Still asleep after 30 seconds. Try waking it again.",
					}
				: state;
	}
}
