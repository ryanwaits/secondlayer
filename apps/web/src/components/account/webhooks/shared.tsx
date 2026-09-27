"use client";

import { CopyButton } from "@/components/copy-button";
import type {
	ChainTrigger,
	WebhookFormat,
	WebhookKind,
	WebhookStatus,
} from "@secondlayer/sdk";
// Subpath import, not the main `@secondlayer/sdk` barrel: that barrel's
// runtime code (unlike a `type` import, which is erased) drags in
// `@secondlayer/shared`'s DB layer — and `postgres`, a Node-only driver —
// into this client component's bundle.
import {
	DOWN_MIN_CONSECUTIVE,
	type DoctorIssue,
} from "@secondlayer/sdk/webhooks/doctor";
import { useEffect, useState } from "react";

/** Small pieces shared by the webhooks list and detail pages: the status
 *  pill, the "Fires on" trigger line, and the CLI command box. Kept here
 *  instead of duplicated so a status label or a trigger's formatting only
 *  has one place to fix. */

/** "Standard Webhooks, signed with your secret", etc. — the config card's
 *  Delivery tab and (until plan 070) the old Settings block. */
export const FORMAT_LABEL: Record<WebhookFormat, string> = {
	"standard-webhooks": "Standard Webhooks, signed with your secret",
	inngest: "Inngest event",
	trigger: "Trigger.dev event",
	cloudflare: "Cloudflare Queues message",
	cloudevents: "CloudEvents envelope",
	raw: "Raw JSON payload",
};

export const STATUS_LABEL: Record<WebhookStatus, string> = {
	active: "Delivering",
	paused: "Paused",
	error: "Failing",
};

export function StatusPill({ status }: { status: WebhookStatus }) {
	return <span className={`wh-pill ${status}`}>{STATUS_LABEL[status]}</span>;
}

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
			<code className="wh-cli-code">
				<span className="wh-cli-p">$</span> {command}
			</code>
			<CopyButton code={command} inline label="Copy" />
		</div>
	);
}

// ── Syntax-highlighted code panels — shared by the delivery card
// (payload/response/headers) and the config card (JSON tab) ──────────────

export function prettyJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function bytes(n: number): string {
	return n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
}

function byteLength(s: string): number {
	return new TextEncoder().encode(s).length;
}

function HighlightedCode({
	code,
	lang,
}: { code: string; lang: "json" | "html" }) {
	const [html, setHtml] = useState<string | null>(null);

	useEffect(() => {
		let stopped = false;
		import("@/lib/highlight-client").then(({ highlightClient }) =>
			highlightClient(code, lang).then((h) => {
				if (!stopped) setHtml(h);
			}),
		);
		return () => {
			stopped = true;
		};
	}, [code, lang]);

	if (!html) return <pre>{code}</pre>;
	// biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered-style syntax highlighting, same pattern as the docs' `highlight()`
	return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A labeled, highlighted code block with byte count and a Copy button — the
 *  delivery card's Payload/Response/Headers tabs and the config card's JSON
 *  tab all render through this one component. */
export function CodePanel({
	label,
	code,
	lang,
	emptyText,
	loading,
}: {
	label: string;
	code: string | null;
	lang: "json" | "html";
	emptyText: string;
	/** The data hasn't loaded yet — distinct from a real empty state, which
	 *  says something specific ("payload no longer kept"). */
	loading?: boolean;
}) {
	if (loading) {
		return (
			<div className="wh-code">
				<p className="wh-code-empty">Loading…</p>
			</div>
		);
	}
	if (code === null || code.length === 0) {
		return (
			<div className="wh-code">
				<p className="wh-code-empty">{emptyText}</p>
			</div>
		);
	}
	return (
		<div className="wh-code">
			<div className="wh-code-head">
				<span>
					{label} · {bytes(byteLength(code))}
				</span>
				<CopyButton code={code} label="Copy" />
			</div>
			<HighlightedCode code={code} lang={lang} />
		</div>
	);
}
