"use client";

import { CopyButton } from "@/components/copy-button";
import type { WebhookStatus } from "@secondlayer/sdk";
// Subpath import, not the main `@secondlayer/sdk` barrel: that barrel's
// runtime code (unlike a `type` import, which is erased) drags in
// `@secondlayer/shared`'s DB layer, and `postgres`, a Node-only driver,
// into this client component's bundle.
import {
	DOWN_MIN_CONSECUTIVE,
	type DoctorIssue,
} from "@secondlayer/sdk/webhooks/doctor";

/** Small pieces the webhook screens, the nav and the account-health rules
 *  share: the status a webhook shows, an event cell, and the CLI command box. */

/** The three codes a failing receiver can carry as the primary issue — a
 *  down receiver still reads "Delivering" if the pill only looked at
 *  `webhook.status` (active/paused), which never moves on its own when
 *  deliveries start failing. */
const FAILING_PRIMARY_CODES: ReadonlySet<DoctorIssue["code"]> = new Set([
	"receiver_down",
	"receiver_rejects",
	"circuit",
]);

/** The status the pill should show, which isn't always `webhook.status`.
 *  Checked in order:
 *  1. Paused with the circuit breaker open → the breaker paused it, not the
 *     user — "error", not "paused".
 *  2. Paused (by the user) → "paused".
 *  3. `circuitFailures` at or past the same threshold `receiver_down` uses
 *     (consecutive; the emitter resets it to 0 on a success) → "error".
 *  4. The primary issue is a "bad"-severity receiver failure → "error".
 *  5. Otherwise → "active".
 *
 *  The list page has no primary issue (no per-row deliveries fetch), so it
 *  reaches rules 1, 2, 3 and 5. */
export function displayStatus(
	webhook: {
		status: WebhookStatus;
		circuitOpenedAt: string | null;
		circuitFailures: number;
	},
	primary?: DoctorIssue | null,
): WebhookStatus {
	if (webhook.status === "paused" && webhook.circuitOpenedAt) return "error";
	if (webhook.status === "paused") return "paused";
	if (webhook.circuitFailures >= DOWN_MIN_CONSECUTIVE) return "error";
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
 *  no `primary`, so rule 4 of `displayStatus` never applies here. */
export function countByDisplayStatus(
	rows: readonly {
		status: WebhookStatus;
		circuitOpenedAt: string | null;
		circuitFailures: number;
	}[],
	status: WebhookStatus,
): number {
	return rows.filter((w) => displayStatus(w) === status).length;
}

/** "SP21YTS…8XEF.pox4-fast-pool-v3" — long enough to recognize, short enough
 *  to sit in a table cell. Only the address part is truncated. Works for any
 *  long identifier (a transaction id has no dot, so it's truncated whole). */
export function shortenPrincipal(value: string): string {
	const dot = value.indexOf(".");
	const addr = dot > 0 ? value.slice(0, dot) : value;
	const shortAddr =
		addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
	return dot > 0 ? `${shortAddr}${value.slice(dot)}` : shortAddr;
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
