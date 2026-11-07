// The one definition of "is this webhook down". The outage watch, insights,
// the SDK doctor and the API summary all derive it here.
//
// This file must stay import-free apart from thresholds: the SDK doctor reaches
// the browser through apps/web, so anything imported here ships to the client.

import { DOWN_MIN_CONSECUTIVE } from "../insights/thresholds";

/** Why a webhook is paused: the customer did it, or the circuit breaker did. */
export type WebhookPauseReason = "user" | "circuit";

export type WebhookHealth =
	| "ok"
	| "failing"
	| "down"
	| "paused_user"
	| "paused_circuit";

/** No successful delivery for this long, on top of `DOWN_MIN_CONSECUTIVE`
 *  failures in a row, means the receiver is down. */
export const DOWN_MIN_MS: number = 15 * 60_000;

/** The webhook fields health reads. Dates arrive as ISO strings (API summary)
 *  or `Date`s (database row). */
export interface WebhookHealthInput {
	status: string;
	/** Absent on a tenant API that predates `pauseReason`. */
	pauseReason?: WebhookPauseReason | null;
	circuitOpenedAt?: string | Date | null;
	/** Consecutive failed deliveries; reset to 0 on a success. */
	circuitFailures: number;
	lastSuccessAt: string | Date | null;
	createdAt: string | Date;
}

const ms = (d: string | Date): number =>
	typeof d === "string" ? Date.parse(d) : d.getTime();

/** The reason a paused webhook is paused; null while active. Falls back to
 *  `circuitOpenedAt` for summaries from an API that predates `pauseReason`. */
export function pauseReasonOf(
	w: Pick<WebhookHealthInput, "status" | "pauseReason" | "circuitOpenedAt">,
): WebhookPauseReason | null {
	if (w.status !== "paused") return null;
	if (w.pauseReason) return w.pauseReason;
	return w.circuitOpenedAt ? "circuit" : "user";
}

/** Locked definition of a down receiver: `DOWN_MIN_CONSECUTIVE`+ failures in a
 *  row and no success for `DOWN_MIN_MS`. A manual pause is never down; a
 *  circuit pause can be. */
export function isReceiverDown(w: WebhookHealthInput, now: number): boolean {
	if (pauseReasonOf(w) === "user") return false;
	if (w.circuitFailures < DOWN_MIN_CONSECUTIVE) return false;
	return now - ms(w.lastSuccessAt ?? w.createdAt) >= DOWN_MIN_MS;
}

export function webhookHealth(
	w: WebhookHealthInput,
	now: number,
): WebhookHealth {
	const reason = pauseReasonOf(w);
	if (reason === "user") return "paused_user";
	if (reason === "circuit") return "paused_circuit";
	if (isReceiverDown(w, now)) return "down";
	return w.circuitFailures > 0 ? "failing" : "ok";
}
