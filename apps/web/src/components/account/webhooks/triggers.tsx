import { CopyButton } from "@/components/copy-button";
import type { ChainTrigger, WebhookActivity } from "@secondlayer/sdk";
// Subpath import, not the main `@secondlayer/sdk` barrel: that barrel's
// runtime code drags `postgres` into this client component's bundle.
// `CHAIN_TRIGGER_FIELDS` is derived straight from the Zod schema the API
// validates create/update against, so this list can't drift behind it.
import {
	CHAIN_TRIGGER_FIELDS,
	type ChainTriggerType,
} from "@secondlayer/sdk/webhooks/triggers";
import { shortenPrincipal } from "./shared";

/**
 * Plain-English reading of a webhook's chain triggers: a noun per type, a
 * sentence per trigger, one condition per set field. Read-only; triggers are
 * defined in code (SDK) and never edited here.
 */

// ── Copy: one noun per chain-trigger type, for the "matches every X on
// chain" warning and the field-table's plain sentence. ─────────────────────

export const TRIGGER_NOUN: Record<ChainTriggerType, string> = {
	stx_transfer: "STX transfer",
	stx_mint: "STX mint",
	stx_burn: "STX burn",
	stx_lock: "STX lock",
	ft_transfer: "token transfer",
	ft_mint: "token mint",
	ft_burn: "token burn",
	nft_transfer: "NFT transfer",
	nft_mint: "NFT mint",
	nft_burn: "NFT burn",
	contract_call: "contract call",
	contract_deploy: "contract deploy",
	print_event: "contract print event",
	nested_contract_call: "nested contract call",
	var_set: "data-var write",
	map_set: "map write",
	map_insert: "map insert",
	map_delete: "map delete",
	sbtc_deposit: "sBTC deposit",
	sbtc_withdrawal_create: "sBTC withdrawal request",
	sbtc_withdrawal_accept: "sBTC withdrawal accept",
	sbtc_withdrawal_reject: "sBTC withdrawal reject",
	sbtc_withdrawal_swept_confirmed: "sBTC withdrawal sweep",
	rune_etch: "rune etch",
	rune_mint: "rune mint",
	rune_transfer: "rune transfer",
	rune_burn: "rune burn",
};

/** Principal-shaped fields, shortened the same way the deliveries table
 *  shortens addresses — everything else (topics, names, hashes) prints as
 *  given. */
const PRINCIPAL_FIELDS = new Set([
	"sender",
	"recipient",
	"contractId",
	"deployer",
	"caller",
	"lockedAddress",
	"address",
]);

const SBTC_TOKEN_SUFFIX = "sbtc-token::sbtc-token";

/** A print `where` filter as text: "signer is SP21…EFFP or SPMP…1TZF and
 *  cycle is 146". Principal-looking values shorten like other addresses. */
function formatWhere(value: unknown): string {
	const where = (value ?? {}) as Record<string, string | readonly string[]>;
	return Object.entries(where)
		.map(([key, expected]) => {
			const values = (Array.isArray(expected) ? expected : [expected]).map(
				(v) =>
					/^S[PTMN]/.test(String(v)) ? shortenPrincipal(String(v)) : String(v),
			);
			return `${key} is ${values.join(" or ")}`;
		})
		.join(" and ");
}

function n(value: number): string {
	return value.toLocaleString("en-US");
}

/** STX types show micro-STX ÷ 1e6 as "STX"; the sBTC token asset shows sats
 *  plus sBTC (÷ 1e8); every other FT shows raw base units — plan 074,
 *  design 4. */
export function formatTriggerAmount(
	trigger: ChainTrigger,
	value: string | number,
): string {
	const amount = Number(value);
	if (trigger.type.startsWith("stx_")) {
		return `${(amount / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 6 })} STX`;
	}
	const assetIdentifier =
		"assetIdentifier" in trigger ? trigger.assetIdentifier : undefined;
	if (assetIdentifier?.endsWith(SBTC_TOKEN_SUFFIX)) {
		const sbtc = (amount / 100_000_000).toLocaleString("en-US", {
			maximumFractionDigits: 8,
		});
		return `${n(amount)} sats (${sbtc} sBTC)`;
	}
	return `${n(amount)} base units`;
}

/** "is" / "at least" / "at most" / "implements", plus the value formatted
 *  for its field — one field row of the trigger's field table. */
export function triggerFieldCondition(
	trigger: ChainTrigger,
	key: string,
	value: unknown,
): { op: string; text: string } {
	if (key === "minAmount") {
		return {
			op: "at least",
			text: formatTriggerAmount(trigger, value as string | number),
		};
	}
	if (key === "maxAmount") {
		return {
			op: "at most",
			text: formatTriggerAmount(trigger, value as string | number),
		};
	}
	if (key === "trait") return { op: "implements", text: String(value) };
	if (key === "where") return { op: "where", text: formatWhere(value) };
	if (key === "assetIdentifier") {
		return { op: "is", text: shortenPrincipal(String(value)) };
	}
	if (PRINCIPAL_FIELDS.has(key)) {
		return { op: "is", text: shortenPrincipal(String(value)) };
	}
	return { op: "is", text: String(value) };
}

/** One phrase per field, in reading order, for the trigger's plain-English
 *  sentence — "Any STX transfer sent by SP21…EFFP of 1 STX or more". */
export const SENTENCE_FIELD_ORDER = [
	"assetIdentifier",
	"contractId",
	"deployer",
	"contractName",
	"functionName",
	"caller",
	"varName",
	"map",
	"topic",
	"where",
	"lockedAddress",
	"bitcoinTxid",
	"sweepTxid",
	"requestId",
	"trait",
	"sender",
	"recipient",
	"rune",
	"address",
	"minAmount",
	"maxAmount",
] as const;

function sentencePhrase(
	trigger: ChainTrigger,
	key: string,
	value: unknown,
): string {
	switch (key) {
		case "assetIdentifier":
			return `of ${shortenPrincipal(String(value).split("::")[0] ?? String(value))}`;
		case "contractId":
			return `from ${shortenPrincipal(String(value))}`;
		case "deployer":
			return `deployed by ${shortenPrincipal(String(value))}`;
		case "contractName":
			return `named ${value}`;
		case "functionName":
			return `calling ${value}`;
		case "caller":
			return `called by ${shortenPrincipal(String(value))}`;
		case "varName":
			return `named ${value}`;
		case "map":
			return `in map ${value}`;
		case "topic":
			return `with topic ${value}`;
		case "where":
			return `where ${formatWhere(value)}`;
		case "lockedAddress":
			return `locking ${shortenPrincipal(String(value))}`;
		case "bitcoinTxid":
			return `from Bitcoin tx ${shortenPrincipal(String(value))}`;
		case "sweepTxid":
			return `swept in ${shortenPrincipal(String(value))}`;
		case "requestId":
			return `request ${value}`;
		case "trait":
			return `implementing ${value}`;
		case "sender":
			return `sent by ${shortenPrincipal(String(value))}`;
		case "recipient":
			return `to ${shortenPrincipal(String(value))}`;
		case "rune":
			return `of ${value}`;
		case "address":
			return `to ${shortenPrincipal(String(value))}`;
		case "minAmount":
			return `of ${formatTriggerAmount(trigger, value as string | number)} or more`;
		case "maxAmount":
			return `of ${formatTriggerAmount(trigger, value as string | number)} or less`;
		default:
			return "";
	}
}

/** "Any STX transfer sent by SP21…EFFP of 1 STX or more" — the trigger
 *  card's one-line summary. Falls back to just "Any <noun>" with no fields
 *  set (the unfiltered case gets its own warning, not a bare sentence). */
export function triggerSentence(trigger: ChainTrigger): string {
	const parts = [`Any ${TRIGGER_NOUN[trigger.type]}`];
	const record = trigger as unknown as Record<string, unknown>;
	for (const key of SENTENCE_FIELD_ORDER) {
		if (record[key] === undefined) continue;
		const phrase = sentencePhrase(trigger, key, record[key]);
		if (phrase) parts.push(phrase);
	}
	return parts.join(" ");
}

/** The fields `trigger` actually sets, in `CHAIN_TRIGGER_FIELDS` order. */
export function setTriggerFields(trigger: ChainTrigger): string[] {
	const record = trigger as unknown as Record<string, unknown>;
	return (CHAIN_TRIGGER_FIELDS[trigger.type] ?? []).filter(
		(key) => record[key] !== undefined,
	);
}

/** The fields `trigger` could set but didn't — "Not filtered: recipient,
 *  maxAmount". */
export function unsetTriggerFields(trigger: ChainTrigger): string[] {
	const record = trigger as unknown as Record<string, unknown>;
	return (CHAIN_TRIGGER_FIELDS[trigger.type] ?? []).filter(
		(key) => record[key] === undefined,
	);
}

// ── Per-trigger volume (design 5) ───────────────────────────────────────

/** `stx_transfer` → `chain.stx_transfer.apply`, the outbox `event_type` a
 *  chain trigger's matches are counted under. */
export function chainEventType(triggerType: ChainTriggerType): string {
	return `chain.${triggerType}.apply`;
}

/** 7-day matched count for one trigger, and whether another trigger of the
 *  same type shares that count (trigger ids don't exist yet, so same-type
 *  triggers can't be told apart — plan 074 maintenance note). */
export function triggerVolume(
	trigger: ChainTrigger,
	allTriggers: ChainTrigger[],
	activity: WebhookActivity | null,
): { count: number; shared: boolean } {
	const count = activity?.byEventType[chainEventType(trigger.type)] ?? 0;
	const shared = allTriggers.filter((t) => t.type === trigger.type).length > 1;
	return { count, shared };
}

/** "About N a day" for an unfiltered trigger's warning — the 7-day count,
 *  averaged and rounded. */
export function perDay(count: number): number {
	return Math.round(count / 7);
}

/** Every unfiltered chain trigger in `triggers` — a trigger with no fields
 *  set matches everything of its type, which is usually a mistake (or a
 *  very deliberate, expensive one). */
export function unfilteredTriggers(triggers: ChainTrigger[]): ChainTrigger[] {
	return triggers.filter((t) => setTriggerFields(t).length === 0);
}

/** The "Listens for" box: each trigger as its type chip, a sentence, and the
 *  filters it sets. An unfiltered trigger says what that costs. */
export function TriggersBox({
	triggers,
	activity,
}: {
	triggers: ChainTrigger[];
	activity: WebhookActivity | null;
}) {
	return (
		<div className="wd-triggers">
			{triggers.map((trigger, index) => {
				const set = setTriggerFields(trigger);
				const record = trigger as unknown as Record<string, unknown>;
				const { count } = triggerVolume(trigger, triggers, activity);
				return (
					// Triggers have no stable id of their own; position is fine, the
					// list never reorders under the reader.
					// biome-ignore lint/suspicious/noArrayIndexKey: triggers are static per webhook
					<div className="wd-trigger" key={index}>
						<code className="wd-chip">{trigger.type}</code>
						<p>{triggerSentence(trigger)}</p>
						{set.length > 0 ? (
							<dl>
								{set.map((key) => {
									const { op, text } = triggerFieldCondition(
										trigger,
										key,
										record[key],
									);
									const long =
										typeof record[key] === "string" &&
										(record[key] as string).length > 24;
									return (
										<div key={key}>
											<dt>{key}</dt>
											<dd>
												<span className="wd-op">{op}</span> {text}
												{long ? (
													<CopyButton code={String(record[key])} label="Copy" />
												) : null}
											</dd>
										</div>
									);
								})}
							</dl>
						) : (
							<p className="wd-warn">
								No filters, so this matches every {TRIGGER_NOUN[trigger.type]}{" "}
								on chain: about {n(perDay(count))} events a day, each one
								delivered and billed.
							</p>
						)}
					</div>
				);
			})}
		</div>
	);
}
