"use client";

import { stacksBlockUrl, stacksTxUrl } from "@/components/verify/explorers";
import { shared } from "@/lib/request-cache";
import { useCopied } from "@/lib/use-copied";
import { getDelivery } from "@/lib/webhooks-data";
import type {
	ChainTrigger,
	DeliveryRow,
	WebhookDeliveryDetail,
} from "@secondlayer/sdk";
import { Fragment, type ReactNode, useEffect, useId, useState } from "react";
import {
	deliveryCopyText,
	deliveryFields,
	payloadBlockHash,
} from "./delivery-view";

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

function kb(text: string): string {
	return `${(new TextEncoder().encode(text).length / 1024).toFixed(1)} KB`;
}

// ── JSON renderer ────────────────────────────────────────────────────────

export function Clamp({ json, marked }: { json: string; marked: boolean }) {
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

/** One read per delivery: a hover read and the click's read that overlap share
 *  one request. A recorded delivery never changes, so `ok` is kept. */
export function readDelivery(webhookId: string, deliveryId: string) {
	return shared(`webhooks:delivery:${deliveryId}`, async () => {
		const res = await getDelivery(webhookId, deliveryId);
		if (res.kind === "ok") cache.set(deliveryId, res.data);
		return res;
	});
}

/** Starts a delivery's read before its row opens. Never throws: the click
 *  path reads again if this one failed. */
export async function prefetchDelivery(
	webhookId: string,
	deliveryId: string,
): Promise<void> {
	if (cache.has(deliveryId)) return;
	try {
		await readDelivery(webhookId, deliveryId);
	} catch {
		// Ignored on purpose.
	}
}

/** Pointer, focus or touch reached a delivery row. A read never wakes an
 *  asleep stack, and an open row has already started its own read. */
export function prefetchOnIntent({
	webhookId,
	deliveryId,
	asleep,
	open,
}: {
	webhookId: string;
	deliveryId: string;
	asleep: boolean;
	open: boolean;
}): void {
	if (asleep || open) return;
	void prefetchDelivery(webhookId, deliveryId);
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
		void readDelivery(webhookId, deliveryId).then((res) => {
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

/** The delivery's detail once read; null while loading, asleep or failed. */
export function useDeliveryDetail(
	webhookId: string,
	deliveryId: string,
	asleep: boolean,
): WebhookDeliveryDetail | null {
	const load = useDelivery(webhookId, deliveryId, asleep);
	return load.status === "ok" ? load.detail : null;
}

function CopyPill({ text }: { text: () => string }) {
	const { copied, copy } = useCopied(1200);
	return (
		<button type="button" className="pv-copy" onClick={() => copy(text())}>
			{copied ? "Copied" : "Copy"}
		</button>
	);
}

type Tab = "fields" | "sent" | "response";

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
	webhookName: string;
	/** Every attempt of this event, oldest first. Copy reads them. */
	attempts: readonly DeliveryRow[];
	/** The page finding that describes these failures, if any. */
	finding: string | null;
	/** Set to an attempt's id when the reader picks it: opens Response. */
	picked?: string | null;
}

/** "0x9b5a…cc41" */
function shortTx(txId: string): string {
	return `${txId.slice(0, 6)}…${txId.slice(-4)}`;
}

function Fields({
	fields,
	isMarked,
}: {
	fields: ReturnType<typeof deliveryFields>;
	isMarked: (value: string) => boolean;
}) {
	return (
		<dl className="pv-fields">
			{fields.map((field, i) => (
				<Fragment key={`${field.group ?? ""}:${field.key}`}>
					{field.group !== null && fields[i - 1]?.group !== field.group ? (
						<dt className="pv-group">{field.group}</dt>
					) : null}
					<dt>{field.key}</dt>
					<dd>
						<Clamp json={field.value} marked={isMarked(field.value)} />
					</dd>
				</Fragment>
			))}
		</dl>
	);
}

/** The viewer itself, given a delivery already read (or still loading). */
export function PayloadPanel({
	load,
	triggers,
	responseBody,
	statusCode,
	responseIsLatest,
	host,
	webhookName,
	attempts,
	finding,
	picked = null,
}: PayloadPanelProps) {
	const [chosen, setChosen] = useState<Tab | null>(null);
	const tipId = useId();
	useEffect(() => {
		if (picked) setChosen("response");
	}, [picked]);
	const asleep = load.status === "asleep";
	const detail = load.status === "ok" ? load.detail : null;
	const payload = detail?.payload ?? null;
	const gone = load.status === "ok" && payload === null;
	const fields = payload === null ? [] : deliveryFields(payload);
	const tab: Tab = asleep
		? "response"
		: (chosen ?? (gone ? "response" : fields.length > 0 ? "fields" : "sent"));
	const response = responseIsLatest
		? (detail?.responseBody ?? responseBody)
		: responseBody;
	const sentText = payload === null ? null : JSON.stringify(payload, null, 2);
	const parsed = parseBody(response);
	const latest = attempts[attempts.length - 1];
	const blockHeight = detail?.blockHeight ?? latest?.blockHeight ?? null;
	const txId = detail?.txId ?? latest?.txId ?? null;
	const blockHash = payload === null ? null : payloadBlockHash(payload);

	let body: ReactNode;
	if (tab === "fields") {
		body = <Fields fields={fields} isMarked={markMatcher(triggers)} />;
	} else if (tab === "sent") {
		if (load.status === "loading") body = "Loading…";
		else if (load.status === "error") body = "Couldn't load the payload.";
		else if (sentText === null) body = null;
		else body = <JsonView value={payload} isMarked={markMatcher(triggers)} />;
	} else if (!parsed) body = "The receiver sent no body.";
	else if ("json" in parsed) body = <JsonView value={parsed.json} />;
	else {
		body = (
			<div className="raw">
				{parsed.raw}
				{parsed.raw.length >= RESPONSE_CAP ? "\n\nCut at 8 KB." : ""}
			</div>
		);
	}

	return (
		<>
			<div className="pv">
				<div className="pv-bar">
					<div className="tabbar mono" role="tablist">
						{fields.length > 0 ? (
							<button
								type="button"
								role="tab"
								aria-selected={tab === "fields"}
								onClick={() => setChosen("fields")}
							>
								Fields
							</button>
						) : null}
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
					<span className="pv-links">
						{blockHeight === null ? null : blockHash ? (
							<a
								href={stacksBlockUrl(blockHash)}
								target="_blank"
								rel="noreferrer"
							>
								Block {blockHeight.toLocaleString("en-US")} ↗
							</a>
						) : (
							<span>Block {blockHeight.toLocaleString("en-US")}</span>
						)}
						{txId === null ? null : (
							<a href={stacksTxUrl(txId)} target="_blank" rel="noreferrer">
								Tx {shortTx(txId)} ↗
							</a>
						)}
					</span>
					{attempts.length > 0 ? (
						<CopyPill
							text={() =>
								deliveryCopyText({
									webhookName,
									host,
									attempts,
									detail,
									finding,
								})
							}
						/>
					) : null}
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
