import type { WebhookSummary } from "@secondlayer/sdk";
import type { ApiKey } from "./types";

const MAX_CHARS = 1500;
/** Longest key prefix we echo. Defensive: a prefix is never a whole key. */
const MAX_PREFIX = 12;

/** The key `/prompt` names: first active one, by name and prefix only. */
export type KeyHint = { name: string; prefix: string };

export function keyHint(keys: ApiKey[] | null): KeyHint | null {
	const first = (keys ?? []).find((k) => k.status === "active");
	return first
		? { name: first.name, prefix: first.prefix.slice(0, MAX_PREFIX) }
		: null;
}

/** A receiver's host only. Paths and query strings can carry tokens. */
export function receiverHost(url: string): string | null {
	try {
		return new URL(url).host || null;
	} catch {
		return null;
	}
}

function webhookLine(w: WebhookSummary): string {
	const host = receiverHost(w.url);
	const failing = w.circuitFailures > 0 ? `, ${w.circuitFailures} failing` : "";
	return `Webhook ${w.name}${host ? ` → ${host}` : ""} (${w.status}${failing})`;
}

/**
 * Plain lines about the reader's account for `/prompt`: attached webhooks
 * first, then the key, then the rest. Keys appear as name + prefix, receivers
 * as host only. Capped at 1500 characters, whole lines only.
 */
export function accountSummary({
	keys,
	webhooks,
	attached = [],
}: {
	keys: ApiKey[] | null;
	webhooks: WebhookSummary[] | null;
	/** Webhook ids the reader attached with `@`. */
	attached?: string[];
}): string {
	const all = webhooks ?? [];
	const pinned = all.filter((w) => attached.includes(w.id));
	const rest = all.filter((w) => !attached.includes(w.id));
	const key = keyHint(keys);
	const lines = [
		...pinned.map(webhookLine),
		...(key ? [`Key: "${key.name}" ${key.prefix}… (prefix only)`] : []),
		...rest.map(webhookLine),
	];

	const out: string[] = [];
	let size = 0;
	for (const line of lines) {
		size += line.length + 1;
		if (size - 1 > MAX_CHARS) break;
		out.push(line);
	}
	return out.join("\n");
}
