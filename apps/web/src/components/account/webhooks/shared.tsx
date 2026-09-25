"use client";

import { CopyButton } from "@/components/copy-button";
import type {
	ChainTrigger,
	WebhookKind,
	WebhookStatus,
} from "@secondlayer/sdk";

/** Small pieces shared by the webhooks list and detail pages: the status
 *  pill, the "Fires on" trigger line, and the CLI command box. Kept here
 *  instead of duplicated so a status label or a trigger's formatting only
 *  has one place to fix. */

export const STATUS_LABEL: Record<WebhookStatus, string> = {
	active: "Delivering",
	paused: "Paused",
	error: "Failing",
};

export function StatusPill({ status }: { status: WebhookStatus }) {
	return <span className={`wh-pill ${status}`}>{STATUS_LABEL[status]}</span>;
}

/** "SP21YTS…8XEF.pox4-fast-pool-v3" — long enough to recognize, short enough
 *  to sit in a table cell. Only the address part is truncated. */
function shortenPrincipal(value: string): string {
	const dot = value.indexOf(".");
	const addr = dot > 0 ? value.slice(0, dot) : value;
	const shortAddr =
		addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
	return dot > 0 ? `${shortAddr}${value.slice(dot)}` : shortAddr;
}

function formatTriggerFieldValue(key: string, value: unknown): string {
	if (
		(key === "minAmount" || key === "maxAmount") &&
		(typeof value === "string" || typeof value === "number")
	) {
		return `${(Number(value) / 1_000_000).toLocaleString("en-US")} STX`;
	}
	return typeof value === "string" ? shortenPrincipal(value) : String(value);
}

/** One chain trigger, e.g. `stx_transfer  sender SP21…8XEF  minAmount 1 STX`. */
export function TriggerLine({ trigger }: { trigger: ChainTrigger }) {
	const fields = Object.entries(trigger).filter(([key]) => key !== "type");
	return (
		<span className="wh-trig">
			<b>{trigger.type}</b>
			{fields.map(([key, value]) => (
				<span key={key}>
					<span className="wh-trig-k">{key}</span>{" "}
					{formatTriggerFieldValue(key, value)}
				</span>
			))}
		</span>
	);
}

/** The "Fires on" cell/fact: a subgraph webhook names its table; a chain
 *  webhook lists its triggers. `WebhookSummary` (the list endpoint) carries
 *  no `triggers` — only `WebhookDetail` does — so a chain row on the list
 *  falls back to a plain label instead of fabricating trigger detail. */
export function FiresOn({
	kind,
	subgraphName,
	tableName,
	triggers,
}: {
	kind: WebhookKind;
	subgraphName: string | null;
	tableName: string | null;
	triggers?: ChainTrigger[] | null;
}) {
	if (kind === "subgraph") {
		return (
			<code className="wh-mono">
				{subgraphName}.{tableName}
			</code>
		);
	}
	if (triggers && triggers.length > 0) {
		return (
			<span className="wh-trig-list">
				{triggers.map((t, i) => (
					// Triggers have no stable id of their own; position is fine, the
					// list never reorders under the reader.
					// biome-ignore lint/suspicious/noArrayIndexKey: triggers are static per webhook
					<TriggerLine key={i} trigger={t} />
				))}
			</span>
		);
	}
	return <span className="acct-muted">Chain trigger</span>;
}

/** `$ <command>` in a dark box with a copy button, for the commands the web
 *  points at instead of doing itself (create, update). */
export function CliLine({ command }: { command: string }) {
	return (
		<div className="wh-cli">
			<code>
				<span className="wh-cli-p">$</span> {command}
			</code>
			<CopyButton code={command} inline label="Copy" />
		</div>
	);
}
