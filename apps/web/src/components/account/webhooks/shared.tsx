"use client";

import { CopyButton } from "@/components/copy-button";
// Subpath import, not the main `@secondlayer/sdk` barrel: that barrel's
// runtime code (unlike a `type` import, which is erased) drags in
// `@secondlayer/shared`'s DB layer, and `postgres`, a Node-only driver,
// into this client component's bundle.
import type { DoctorIssue } from "@secondlayer/sdk/webhooks/doctor";
import {
	type WebhookHealth,
	type WebhookPauseReason,
	webhookHealth,
} from "@secondlayer/shared/webhooks/health";
import { shortenPrincipal } from "./principal";

/** Small pieces the webhook screens, the nav and the account-health rules
 *  share: the status a webhook shows, an event cell, and the CLI command box. */

/** The three codes a failing receiver can carry as the primary issue: a
 *  receiver the doctor calls bad still reads as failing even before the
 *  health verdict (failures plus time) catches up. */
const FAILING_PRIMARY_CODES: ReadonlySet<DoctorIssue["code"]> = new Set([
	"receiver_down",
	"receiver_rejects",
	"circuit",
]);

/** The webhook fields the dashboard's state reads need. */
export interface WebhookStateInput {
	status: string;
	/** The server's verdict. Absent from an API that predates it. */
	health?: WebhookHealth;
	pauseReason?: WebhookPauseReason | null;
	circuitOpenedAt?: string | null;
	circuitFailures: number;
	lastSuccessAt: string | null;
	createdAt: string;
}

/** The one definition of "paused" the dashboard acts on: the pause and resume
 *  buttons, their labels and their undo all read it. Why it is paused (you or
 *  the circuit breaker) is `pauseReasonOf`. */
export function isPaused(webhook: { status: string }): boolean {
	return webhook.status === "paused";
}

/** What the pill and counts show: `paused` is paused by you, `error` is
 *  anything that stops or fails deliveries (a circuit pause or a down
 *  receiver), `active` is the rest. */
export type ShownStatus = "active" | "paused" | "error";

/** The status the pill should show: the server's `health` verdict when the
 *  row carries one, else the shared rule (`webhookHealth`) on the browser's
 *  clock, for an API that predates it. A doctor `primary` issue that is a bad receiver failure
 *  also reads as failing, ahead of the verdict's time threshold.
 *
 *  The list page has no primary issue (no per-row deliveries fetch). */
export function displayStatus(
	webhook: WebhookStateInput,
	primary?: DoctorIssue | null,
	now: number = Date.now(),
): ShownStatus {
	const health = webhook.health ?? webhookHealth(webhook, now);
	if (health === "paused_user") return "paused";
	if (health === "paused_circuit" || health === "down") return "error";
	if (
		primary &&
		primary.severity === "bad" &&
		FAILING_PRIMARY_CODES.has(primary.code)
	) {
		return "error";
	}
	return "active";
}

/** How many of these rows would show `status` as their pill: the list
 *  page's "Delivering N of M" / "Needs attention" stats. Summary rows carry
 *  no `primary`, so a doctor issue never applies here. */
export function countByDisplayStatus(
	rows: readonly WebhookStateInput[],
	status: ShownStatus,
	now: number = Date.now(),
): number {
	return rows.filter((w) => displayStatus(w, null, now) === status).length;
}

/** A webhook name with every Stacks address in it shortened, so a
 *  Sentinel-made name like `sentinel:SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-sbtc:~dea8…`
 *  reads `sentinel:SP1A27…ADJ7.v0-vault-sbtc:~dea8…`. Show the full name in a
 *  `title` beside it. */
export function shortenName(name: string): string {
	return name.replace(
		/\bS[PMTN][0-9A-Z]{26,41}\b/g,
		(addr) => `${addr.slice(0, 6)}…${addr.slice(-4)}`,
	);
}

/** "0x920a…2c77 #408" for the deliveries table's Event column — a short tx
 *  plus its position in that block/tx, or "–" without one (a test delivery,
 *  or an event already compacted out of the outbox). */
export function formatEventCell(
	txId: string | null,
	eventIndex: number | null,
): string {
	if (!txId) return "–";
	const short = shortenPrincipal(txId);
	return eventIndex === null ? short : `${short} #${eventIndex}`;
}

/** `$ <command>` in a dark box with a copy button, for the commands the web
 *  points at instead of doing itself (create, update). */
export function CliLine({ command }: { command: string }) {
	return (
		<div className="wh-cli">
			<code className="wh-cli-code">
				<span className="wh-cli-p">$</span> {command}
			</code>
			<CopyButton code={command} inline label="Copy" />
		</div>
	);
}
