"use client";

import { FloatingCard } from "@/components/account/floating-card";
import { CopyButton } from "@/components/copy-button";
import { getDelivery, requeue } from "@/lib/webhooks-data";
import type { DeliveryRow, WebhookDeliveryDetail } from "@secondlayer/sdk";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { shortenPrincipal } from "./shared";

/** Common status texts for the delivery card's title. Anything else falls
 *  back to just the number — the receiver's own text, when we have one, adds
 *  nothing the code doesn't already say. */
const STATUS_TEXT: Record<number, string> = {
	200: "OK",
	201: "Created",
	202: "Accepted",
	204: "No Content",
	400: "Bad Request",
	401: "Unauthorized",
	403: "Forbidden",
	404: "Not Found",
	408: "Request Timeout",
	429: "Too Many Requests",
	500: "Internal Server Error",
	502: "Bad Gateway",
	503: "Service Unavailable",
	504: "Gateway Timeout",
};

type DeliveryTab = "payload" | "response" | "headers";

function bytes(n: number): string {
	return n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
}

function byteLength(s: string): number {
	return new TextEncoder().encode(s).length;
}

/** Pretty JSON when it parses as JSON; otherwise the raw text, unchanged
 *  ("anything else is shown as sent" — plan 070). */
function prettyOrRaw(text: string): { text: string; lang: "json" | "html" } {
	try {
		return { text: JSON.stringify(JSON.parse(text), null, 2), lang: "json" };
	} catch {
		return { text, lang: "html" };
	}
}

function prettyJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function buildCurlCommand(url: string, payload: unknown): string {
	const body = JSON.stringify(payload ?? {}, null, 2);
	const escaped = body.replace(/'/g, `'\\''`);
	return [
		"# signature headers omitted; they need your secret",
		`curl -X POST '${url}' \\`,
		`  -H 'content-type: application/json' \\`,
		`  -d '${escaped}'`,
	].join("\n");
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

function CodePanel({
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
	/** `detail` hasn't loaded yet — distinct from a real empty state, which
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

export function DeliveryCard({
	webhookId,
	webhookUrl,
	maxRetries,
	rows,
	openIndex,
	onClose,
	onNavigate,
}: {
	webhookId: string;
	webhookUrl: string;
	maxRetries: number;
	/** The visible rows (5 or up to 100), newest first — same order as the table. */
	rows: DeliveryRow[];
	openIndex: number | null;
	onClose: () => void;
	onNavigate: (index: number) => void;
}) {
	const open = openIndex !== null;
	const row = open && openIndex !== null ? (rows[openIndex] ?? null) : null;
	const [detail, setDetail] = useState<WebhookDeliveryDetail | null>(null);
	const [tab, setTab] = useState<DeliveryTab>("payload");
	const [resending, setResending] = useState(false);

	const rowId = row?.id ?? null;
	useEffect(() => {
		if (!rowId) {
			setDetail(null);
			return;
		}
		setDetail(null);
		setTab("payload");
		let stopped = false;
		getDelivery(webhookId, rowId).then((res) => {
			if (!stopped && res.kind === "ok") setDetail(res.data);
		});
		return () => {
			stopped = true;
		};
	}, [rowId, webhookId]);

	if (!open || !row) return null;

	const ok = row.statusCode !== null && row.statusCode < 300;
	const title = row.statusCode
		? `${row.statusCode} ${STATUS_TEXT[row.statusCode] ?? ""}`.trim()
		: "No response";
	const sentAt = row.dispatchedAt.slice(11, 19);

	async function onResend() {
		if (!detail?.outboxId) return;
		setResending(true);
		const res = await requeue(webhookId, detail.outboxId);
		setResending(false);
		if (res.kind === "ok") {
			toast.success("Event resent");
			return;
		}
		toast.error("Couldn't resend that event");
	}

	const payloadText =
		detail && detail.payload !== null ? prettyJson(detail.payload) : null;
	const response = row.responseBody ? prettyOrRaw(row.responseBody) : null;
	const headersJson = detail?.responseHeaders
		? prettyJson(detail.responseHeaders)
		: null;

	return (
		<FloatingCard
			open={open}
			onClose={onClose}
			title={
				<span className={`wh-dl-status ${ok ? "ok" : "bad"}`}>
					<i className="wh-dl-dot" />
					<span>{title}</span>
				</span>
			}
			subtitle={`Attempt ${row.attempt} of ${maxRetries} · ${row.durationMs ?? "–"} ms · sent ${sentAt} UTC`}
			headerActions={
				<>
					<button
						type="button"
						className="acct-card-icon"
						aria-label="Newer delivery"
						disabled={openIndex === 0}
						onClick={() => onNavigate((openIndex ?? 0) - 1)}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<path d="M4 10l4-4 4 4" />
						</svg>
					</button>
					<button
						type="button"
						className="acct-card-icon"
						aria-label="Older delivery"
						disabled={openIndex === rows.length - 1}
						onClick={() => onNavigate((openIndex ?? 0) + 1)}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<path d="M4 6l4 4 4-4" />
						</svg>
					</button>
				</>
			}
			footer={
				<div className="acct-card-row">
					<p className="acct-fine">
						Payload kept 7 days. Response body capped at 8 KB.
					</p>
					<div className="wh-actions">
						<button
							type="button"
							className="acct-btn line small"
							onClick={() => {
								navigator.clipboard
									.writeText(buildCurlCommand(webhookUrl, detail?.payload))
									.catch(() => {});
								toast.success("curl command copied");
							}}
						>
							Copy as curl
						</button>
						{detail?.outboxStatus === "dead" ? (
							<button
								type="button"
								className="acct-btn solid small"
								onClick={onResend}
								disabled={resending}
							>
								{resending ? "Resending..." : "Resend event"}
							</button>
						) : null}
					</div>
				</div>
			}
		>
			<dl className="wh-dl-meta">
				<div>
					<dt>Block</dt>
					<dd>
						{detail?.blockHeight == null
							? "–"
							: detail.blockHeight.toLocaleString("en-US")}
					</dd>
				</div>
				<div>
					<dt>Event</dt>
					<dd>{detail?.eventType ?? "–"}</dd>
				</div>
				<div>
					<dt>Event index</dt>
					<dd>{detail?.eventIndex ?? "–"}</dd>
				</div>
				<div>
					<dt>Transaction</dt>
					<dd>{detail?.txId ? shortenPrincipal(detail.txId) : "–"}</dd>
				</div>
				<div>
					<dt>Try</dt>
					<dd>
						{row.attempt} of {maxRetries}
					</dd>
				</div>
				<div>
					<dt>Duration</dt>
					<dd>{row.durationMs ?? "–"} ms</dd>
				</div>
			</dl>

			{!ok ? (
				<p className="wh-dl-err">
					<i className="wh-dl-dot" />
					<span>
						{row.statusCode
							? `Your receiver answered ${row.statusCode} after ${row.durationMs ?? "–"} ms.`
							: `No response within the ${row.durationMs ?? "–"} ms timeout.`}{" "}
						We retry with backoff, up to {maxRetries} tries.
					</span>
				</p>
			) : null}

			<div className="wh-tabs" role="tablist">
				<button
					type="button"
					role="tab"
					aria-selected={tab === "payload"}
					onClick={() => setTab("payload")}
				>
					Payload
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === "response"}
					onClick={() => setTab("response")}
				>
					Response
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === "headers"}
					onClick={() => setTab("headers")}
				>
					Headers
				</button>
			</div>

			{tab === "payload" ? (
				<CodePanel
					label="application/json"
					code={payloadText}
					lang="json"
					emptyText="Payload no longer kept. We keep payloads 7 days after delivery."
					loading={!detail}
				/>
			) : null}
			{tab === "response" ? (
				<CodePanel
					label="response body"
					code={response?.text ?? null}
					lang={response?.lang ?? "html"}
					emptyText="No response body."
				/>
			) : null}
			{tab === "headers" ? (
				<CodePanel
					label="response headers"
					code={headersJson}
					lang="json"
					emptyText="No response headers."
					loading={!detail}
				/>
			) : null}
		</FloatingCard>
	);
}
