"use client";

import { getDelivery } from "@/lib/webhooks-data";
import type { ChainTrigger, WebhookDeliveryDetail } from "@secondlayer/sdk";
import { Fragment, type ReactNode, useEffect, useId, useState } from "react";

/**
 * One delivery's payload as readable JSON: what we sent, and what the
 * receiver sent back. Pretty-printed (no tree, no folding, no highlighter),
 * with long strings clamped inline and values the trigger filtered on marked.
 * Mounted only when a delivery row is open, so closed rows cost nothing.
 */

/** A JSON string longer than this (quotes included) is clamped. */
const CLAMP_OVER = 80;
const CLAMP_HEAD = 26;
const CLAMP_TAIL = 12;
/** The emitter stores at most this much of a receiver's response. */
const RESPONSE_CAP = 8192;

// ── Pure helpers ─────────────────────────────────────────────────────────

function collectStrings(value: unknown, into: string[]): void {
	if (typeof value === "string") into.push(value);
	else if (Array.isArray(value)) for (const v of value) collectStrings(v, into);
	else if (value && typeof value === "object") {
		for (const v of Object.values(value)) collectStrings(v, into);
	}
}

/** True for a string equal to one of the triggers' filter values; a value
 *  ending in `*` matches by prefix. Amount filters are not strings, so they
 *  never mark. */
export function markMatcher(
	triggers: readonly ChainTrigger[],
): (value: string) => boolean {
	const patterns: string[] = [];
	for (const trigger of triggers) {
		for (const [field, value] of Object.entries(trigger)) {
			if (field !== "type") collectStrings(value, patterns);
		}
	}
	const exact = new Set<string>();
	const prefixes: string[] = [];
	for (const p of patterns) {
		if (p.endsWith("*")) prefixes.push(p.slice(0, -1));
		else exact.add(p);
	}
	return (value) =>
		exact.has(value) || prefixes.some((prefix) => value.startsWith(prefix));
}

/** Pieces of a JSON-encoded string (quotes included), or null when it fits. */
export function clampString(
	json: string,
): { head: string; tail: string; hidden: number } | null {
	if (json.length <= CLAMP_OVER) return null;
	return {
		head: json.slice(0, CLAMP_HEAD),
		tail: json.slice(-CLAMP_TAIL),
		hidden: json.length - (CLAMP_HEAD + CLAMP_TAIL),
	};
}

export function parseBody(
	text: string | null,
): { json: unknown } | { raw: string } | null {
	if (!text) return null;
	try {
		return { json: JSON.parse(text) };
	} catch {
		return { raw: text };
	}
}

/** The attempt whose response the Response tab shows: the newest that got
 *  one, else the newest attempt. `attempts` is oldest first. */
export function answeredAttempt<T extends { responseBody?: string | null }>(
	attempts: readonly T[],
): T {
	const newest = attempts[attempts.length - 1] as T;
	return [...attempts].reverse().find((a) => a.responseBody) ?? newest;
}

function kb(text: string): string {
	return `${(new TextEncoder().encode(text).length / 1024).toFixed(1)} KB`;
}

// ── JSON renderer ────────────────────────────────────────────────────────

function Clamp({ json, marked }: { json: string; marked: boolean }) {
	const [open, setOpen] = useState(false);
	const clamp = clampString(json);
	const body =
		!clamp || open ? (
			<span className="s">{json}</span>
		) : (
			<>
				<span className="s">{clamp.head}</span>
				<span className="p">…</span>
				<span className="s">{clamp.tail}</span>
				<button type="button" className="pv-more" onClick={() => setOpen(true)}>
					+{clamp.hidden.toLocaleString("en-US")}
				</button>
			</>
		);
	return marked ? <span className="m">{body}</span> : body;
}

function Punct({ children }: { children: ReactNode }) {
	return <span className="p">{children}</span>;
}

function renderNode(
	value: unknown,
	depth: number,
	isMarked: (value: string) => boolean,
): ReactNode {
	if (typeof value === "string") {
		return <Clamp json={JSON.stringify(value)} marked={isMarked(value)} />;
	}
	if (typeof value === "number") return <span className="n">{value}</span>;
	if (value === null || typeof value !== "object") {
		return <span className="b">{String(value)}</span>;
	}
	const isArray = Array.isArray(value);
	const entries: [string, unknown][] = isArray
		? value.map((v, i) => [String(i), v])
		: Object.entries(value);
	const [open, close] = isArray ? ["[", "]"] : ["{", "}"];
	if (entries.length === 0) {
		return (
			<Punct>
				{open}
				{close}
			</Punct>
		);
	}
	const pad = "  ".repeat(depth);
	return (
		<>
			<Punct>{open}</Punct>
			{entries.map(([key, child], i) => (
				<Fragment key={key}>
					{"\n"}
					{pad}
					{"  "}
					{isArray ? null : (
						<>
							<span className="key">{JSON.stringify(key)}</span>
							<Punct>: </Punct>
						</>
					)}
					{renderNode(child, depth + 1, isMarked)}
					{i < entries.length - 1 ? <Punct>,</Punct> : null}
				</Fragment>
			))}
			{"\n"}
			{pad}
			<Punct>{close}</Punct>
		</>
	);
}

/** Pretty-printed JSON with the docs code ladder; `isMarked` values get the
 *  yellow mark. */
export function JsonView({
	value,
	isMarked = () => false,
}: { value: unknown; isMarked?: (value: string) => boolean }) {
	return <div className="j">{renderNode(value, 0, isMarked)}</div>;
}

// ── The viewer ───────────────────────────────────────────────────────────

export type Load =
	| { status: "loading" }
	| { status: "error" }
	/** The hosted stack is asleep: the payload lives there, the response
	 *  came with the deliveries list. */
	| { status: "asleep" }
	| { status: "ok"; detail: WebhookDeliveryDetail };

/** Delivery details already read, so reopening a row doesn't refetch. */
const cache = new Map<string, WebhookDeliveryDetail>();

function initialLoad(deliveryId: string, asleep: boolean): Load {
	const hit = cache.get(deliveryId);
	if (hit) return { status: "ok", detail: hit };
	return asleep ? { status: "asleep" } : { status: "loading" };
}

/** Reads one delivery, unless the page already knows the stack is asleep
 *  (a read there never wakes it). Waking re-runs the read. */
function useDelivery(
	webhookId: string,
	deliveryId: string,
	asleep: boolean,
): Load {
	const [load, setLoad] = useState<Load>(() => initialLoad(deliveryId, asleep));
	useEffect(() => {
		const initial = initialLoad(deliveryId, asleep);
		setLoad(initial);
		if (initial.status !== "loading") return;
		let live = true;
		void getDelivery(webhookId, deliveryId).then((res) => {
			if (res.kind === "ok") cache.set(deliveryId, res.data);
			if (!live) return;
			if (res.kind === "ok") setLoad({ status: "ok", detail: res.data });
			else if (res.kind === "asleep") setLoad({ status: "asleep" });
			else setLoad({ status: "error" });
		});
		return () => {
			live = false;
		};
	}, [webhookId, deliveryId, asleep]);
	return load;
}

function CopyPill({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			className="pv-copy"
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(text);
					setCopied(true);
					setTimeout(() => setCopied(false), 1200);
				} catch {
					// Clipboard blocked: leave the label as is.
				}
			}}
		>
			{copied ? "Copied" : "Copy"}
		</button>
	);
}

type Tab = "sent" | "response";

export function PayloadView({
	webhookId,
	deliveryId,
	asleep,
	...rest
}: {
	webhookId: string;
	deliveryId: string;
	/** The page's last poll found the hosted stack asleep. */
	asleep: boolean;
} & Omit<PayloadPanelProps, "load">) {
	return (
		<PayloadPanel load={useDelivery(webhookId, deliveryId, asleep)} {...rest} />
	);
}

interface PayloadPanelProps {
	load: Load;
	triggers: readonly ChainTrigger[];
	/** The response of the attempt shown on the Response tab. */
	responseBody: string | null;
	statusCode: number | null;
	/** True when that attempt is the one the fetched detail describes, so the
	 *  detail's (untruncated-by-the-list) body may stand in for `responseBody`. */
	responseIsLatest: boolean;
	host: string;
}

/** The viewer itself, given a delivery already read (or still loading). */
export function PayloadPanel({
	load,
	triggers,
	responseBody,
	statusCode,
	responseIsLatest,
	host,
}: PayloadPanelProps) {
	const [chosen, setChosen] = useState<Tab | null>(null);
	const tipId = useId();
	const asleep = load.status === "asleep";
	const detail = load.status === "ok" ? load.detail : null;
	const payload = detail?.payload ?? null;
	const gone = load.status === "ok" && payload === null;
	const tab: Tab = asleep
		? "response"
		: (chosen ?? (gone ? "response" : "sent"));
	const response = responseIsLatest
		? (detail?.responseBody ?? responseBody)
		: responseBody;
	const sentText = payload === null ? null : JSON.stringify(payload, null, 2);
	const parsed = parseBody(response);

	let body: ReactNode;
	let copy = "";
	if (tab === "sent") {
		if (load.status === "loading") body = "Loading…";
		else if (load.status === "error") body = "Couldn't load the payload.";
		else if (sentText === null) body = null;
		else {
			copy = sentText;
			body = <JsonView value={payload} isMarked={markMatcher(triggers)} />;
		}
	} else {
		copy = response ?? "";
		if (!parsed) body = "The receiver sent no body.";
		else if ("json" in parsed) body = <JsonView value={parsed.json} />;
		else {
			body = (
				<div className="raw">
					{parsed.raw}
					{parsed.raw.length >= RESPONSE_CAP ? "\n\nCut at 8 KB." : ""}
				</div>
			);
		}
	}

	return (
		<>
			<div className="pv">
				<div className="pv-bar">
					<div className="tabbar mono" role="tablist">
						<button
							type="button"
							role="tab"
							aria-selected={tab === "sent"}
							aria-disabled={asleep || undefined}
							aria-describedby={asleep ? tipId : undefined}
							onClick={() => {
								if (!asleep) setChosen("sent");
							}}
						>
							Sent
							{sentText !== null ? (
								<span className="n">{kb(sentText)}</span>
							) : null}
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={tab === "response"}
							onClick={() => setChosen("response")}
						>
							Response {statusCode ?? "none"}
							{response ? <span className="n">{kb(response)}</span> : null}
						</button>
					</div>
					{copy ? <CopyPill text={copy} /> : null}
					{asleep ? (
						<span className="pv-tip" role="tooltip" id={tipId}>
							Resume this webhook to see what was sent
						</span>
					) : null}
				</div>
				{gone ? (
					<p className="pv-note pv-note-in">
						The payload isn't kept after delivery cleanup. The response is
						below.
					</p>
				) : null}
				<div className="pv-body">{body}</div>
			</div>
			{tab === "response" ? (
				<p className="pv-note">
					What {host} sent back. Stored up to 8 KB per attempt.
				</p>
			) : null}
		</>
	);
}
