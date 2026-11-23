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

/** The three codes a failing receiver can carry as the primary issue: a
 *  receiver the doctor calls bad still reads as failing even before the
 *  health verdict (failures plus time) catches up. */
const FAILING_PRIMARY_CODES: ReadonlySet<DoctorIssue["code"]> = new Set([
	"receiver_down",
	"receiver_rejects",
	"circuit",
]);

export interface WebhookStateInput {
	status: string;
	health?: WebhookHealth;
	pauseReason?: WebhookPauseReason | null;
	circuitOpenedAt?: string | null;
	circuitFailures: number;
	lastSuccessAt: string | null;
	createdAt: string;
}

export function isPaused(webhook: { status: string }): boolean {
	return webhook.status === "paused";
}

export type ShownStatus = "active" | "paused" | "error";

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

export function countByDisplayStatus(
	rows: readonly WebhookStateInput[],
	status: ShownStatus,
	now: number = Date.now(),
): number {
	return rows.filter((w) => displayStatus(w, null, now) === status).length;
}

export function shortenName(name: string): string {
	return name.replace(
		/\bS[PMTN][0-9A-Z]{26,41}\b/g,
		(addr) => `${addr.slice(0, 6)}…${addr.slice(-4)}`,
	);
}

export function formatEventCell(
	txId: string | null,
	eventIndex: number | null,
): string {
	if (!txId) return "–";
	const short = shortenPrincipal(txId);
	return eventIndex === null ? short : `${short} #${eventIndex}`;
}

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
