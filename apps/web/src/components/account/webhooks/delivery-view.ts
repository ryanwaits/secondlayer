import type { DeliveryRow, WebhookDeliveryDetail } from "@secondlayer/sdk";
import { isOk } from "./view";

/** Insight rules that describe this webhook's deliveries failing. */
export const FAILURE_RULES: ReadonlySet<string> = new Set([
	"receiver_down",
	"receiver_rejects",
	"receiver_rate_limited",
	"receiver_login_wall",
	"dead_letters_expiring",
]);

/** Mirrors `plainSnippet` in `packages/shared/src/insights/prompt.ts`; the
 *  shared insights entry point also exports DB code, so it isn't client-safe.
 *  Keep the two in step. */
export function plainLine(text: string | null | undefined, max = 80): string {
	if (!text) return "";
	const flat = text
		.replace(/<[^>]*>/g, " ")
		.replace(/=>/g, "->")
		.replace(/[`{}$\\]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}...` : flat;
}

/** "+4m 02s" from the first attempt; the first attempt itself has no offset. */
export function offsetLabel(ms: number): string {
	if (ms <= 0) return "";
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `+${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `+${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function codeLabel(row: Pick<DeliveryRow, "statusCode">): string {
	return row.statusCode === null ? "timeout" : String(row.statusCode);
}

/** The attempt whose response the Response tab shows: the newest that got
 *  one, else the newest attempt. `attempts` is oldest first. */
export function answeredAttempt<T extends { responseBody?: string | null }>(
	attempts: readonly T[],
): T {
	const newest = attempts[attempts.length - 1] as T;
	return [...attempts].reverse().find((a) => a.responseBody) ?? newest;
}

/** How many tries an event took. The list can be cut at 100 attempts, and
 *  `attempt` is the true attempt number. */
function tries(attempts: readonly DeliveryRow[]): number {
	const latest = attempts[attempts.length - 1];
	return Math.max(attempts.length, latest?.attempt ?? 0);
}

/** "8 tries" when the event was retried, else null. `attempts` is oldest first. */
export function statusSuffix(attempts: readonly DeliveryRow[]): string | null {
	const n = tries(attempts);
	return n > 1 ? `${n} tries` : null;
}

// ── Fields ───────────────────────────────────────────────────────────────

export interface DeliveryField {
	group: string | null;
	key: string;
	value: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The delivered body: `{ event, trigger, block_time, … }`, whether or not it
 *  arrives wrapped in a `{ type, data }` envelope. */
function eventBody(payload: unknown): Record<string, unknown> | null {
	if (!isPlainObject(payload)) return null;
	if ("event" in payload) return payload;
	const inner = payload.data;
	return isPlainObject(inner) && "event" in inner ? inner : payload;
}

function scalar(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === null) return "null";
	if (Array.isArray(value)) return JSON.stringify(value);
	return String(value);
}

function flatten(
	source: Record<string, unknown>,
	skip: string | null,
	prefix = "",
): [string, string][] {
	const out: [string, string][] = [];
	for (const [key, value] of Object.entries(source)) {
		if (prefix === "" && key === skip) continue;
		const path = prefix ? `${prefix}.${key}` : key;
		if (isPlainObject(value)) out.push(...flatten(value, null, path));
		else out.push([path, scalar(value)]);
	}
	return out;
}

/** The values people read: the decoded event first, then where it came from.
 *  Empty when the payload has no `event.data`, which hides the Fields tab. */
export function deliveryFields(payload: unknown): DeliveryField[] {
	const body = eventBody(payload);
	const event = body?.event;
	const data = isPlainObject(event) ? event.data : null;
	if (!body || !isPlainObject(data)) return [];
	const decoded = isPlainObject(data.value);
	const fields: DeliveryField[] = flatten(
		decoded ? (data.value as Record<string, unknown>) : data,
		null,
	).map(([key, value]) => ({ group: null, key, value }));
	const origin: [string, string][] = decoded ? flatten(data, "value") : [];
	if (typeof body.trigger === "string") origin.push(["trigger", body.trigger]);
	if (typeof body.block_time === "string") {
		origin.push(["block time", `${body.block_time.slice(11, 19)} UTC`]);
	}
	for (const [key, value] of origin) {
		fields.push({ group: "Event", key, value });
	}
	return fields;
}

/** The block's hash from a delivered body, for the explorer link. */
export function payloadBlockHash(payload: unknown): string | null {
	const hash = eventBody(payload)?.block_hash;
	return typeof hash === "string" ? hash : null;
}

// ── Copy ─────────────────────────────────────────────────────────────────

export interface DeliveryCopyInput {
	webhookName: string;
	host: string;
	/** Oldest first. */
	attempts: readonly DeliveryRow[];
	/** The latest attempt's detail; null while it loads. */
	detail: WebhookDeliveryDetail | null;
	/** The page finding that describes these failures, when there is one. */
	finding: string | null;
}

function pretty(body: string): string {
	try {
		return JSON.stringify(JSON.parse(body), null, 2);
	} catch {
		return plainLine(body, 400);
	}
}

function clock(iso: string): string {
	return `${iso.slice(11, 19)} UTC`;
}

/** Plain evidence about one event, for pasting anywhere. It never asks an
 *  agent to act: that is the insight card's hand-off. */
export function deliveryCopyText({
	webhookName,
	host,
	attempts,
	detail,
	finding,
}: DeliveryCopyInput): string {
	const latest = attempts[attempts.length - 1] as DeliveryRow;
	const n = tries(attempts);
	const firstFailure = attempts.find((a) => !isOk(a));
	const trouble = firstFailure !== undefined;
	const blocks: string[] = [];

	if (trouble) {
		const lead: string[] = [];
		if (detail?.outboxStatus === "dead") {
			lead.push(`Gave up after ${n} attempts; held for resend.`);
		} else if (!isOk(latest)) {
			lead.push(`Failing after ${n} attempts; still retrying.`);
		} else {
			lead.push(`Delivered on try ${n} after ${n - 1} failures.`);
		}
		const error = plainLine(firstFailure.errorMessage);
		lead.push(
			`First failure: ${codeLabel(firstFailure)}${error ? ` ${error}` : ""}`,
		);
		if (finding) lead.push(`Finding: ${finding}`);
		blocks.push(lead.join("\n"));
	}

	const blockHeight = detail?.blockHeight ?? latest.blockHeight;
	const txId = detail?.txId ?? latest.txId;
	const eventIndex = detail?.eventIndex ?? latest.eventIndex;
	const body = eventBody(detail?.payload ?? null);
	const trigger = typeof body?.trigger === "string" ? body.trigger : null;
	const event = [
		detail?.eventType ?? trigger ?? "event",
		blockHeight === null
			? null
			: `block ${blockHeight.toLocaleString("en-US")}`,
		txId === null
			? null
			: `tx ${txId}${eventIndex === null ? "" : ` #${eventIndex}`}`,
	]
		.filter(Boolean)
		.join(" · ");
	const facts = [`Webhook   ${webhookName} → ${host}`, `Event     ${event}`];
	if (!trouble) {
		const ms = latest.durationMs === null ? "–" : `${latest.durationMs}`;
		facts.push(`Result    ${codeLabel(latest)} in ${ms} ms, first try`);
	}
	blocks.push(facts.join("\n"));

	if (trouble) {
		blocks.push(
			attempts
				.map((a) => {
					const ms = a.durationMs === null ? "–" : `${a.durationMs} ms`;
					const error = plainLine(a.errorMessage);
					return `  ${a.attempt}  ${codeLabel(a).padEnd(7)} ${ms.padEnd(7)} ${clock(a.dispatchedAt)}${error ? `  ${error}` : ""}`;
				})
				.join("\n"),
		);
	}

	if (detail?.outboxStatus === "dead" && detail.outboxId) {
		blocks.push(
			`Resend\n  sl webhooks requeue ${webhookName} ${detail.outboxId}`,
		);
	}

	if (detail?.payload != null) {
		blocks.push(`Payload\n${JSON.stringify(detail.payload, null, 2)}`);
	}

	const answered = answeredAttempt(attempts);
	const responseText =
		answered.id === latest.id
			? (detail?.responseBody ?? answered.responseBody)
			: answered.responseBody;
	if (responseText) {
		blocks.push(`Response (${codeLabel(answered)})\n${pretty(responseText)}`);
	} else {
		blocks.push(`Response\n  none: ${plainLine(latest.errorMessage)}`);
	}

	blocks.push("Docs https://www.secondlayer.tools/docs/webhooks");
	return blocks.join("\n\n");
}
