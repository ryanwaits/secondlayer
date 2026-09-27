"use client";

import { FloatingCard } from "@/components/account/floating-card";
import { CopyButton } from "@/components/copy-button";
import { formatDate } from "@/lib/account-data";
import { hostOf } from "@/lib/webhooks-data";
import type {
	ChainTrigger,
	WebhookActivity,
	WebhookDetail,
} from "@secondlayer/sdk";
// Subpath import, not the main `@secondlayer/sdk` barrel — see `shared.tsx`'s
// note on why: the barrel's runtime code drags `postgres` into this client
// bundle. `CHAIN_TRIGGER_FIELDS` is derived straight from the Zod schema the
// API validates create/update against, so this list can't drift behind it.
import {
	CHAIN_TRIGGER_FIELDS,
	type ChainTriggerType,
} from "@secondlayer/sdk/webhooks/triggers";
import {
	CliLine,
	CodePanel,
	FORMAT_LABEL,
	prettyJson,
	shortenPrincipal,
} from "./shared";

/**
 * The webhook config side card (option C, plan 074): a plain-English read of
 * what a webhook fires on and where it delivers, opened from the page's
 * summary line or its "Open configuration" row — never edited here (create
 * and update stay CLI/SDK-only, by founder rule).
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
]);

const SBTC_TOKEN_SUFFIX = "sbtc-token::sbtc-token";

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
	"lockedAddress",
	"bitcoinTxid",
	"sweepTxid",
	"requestId",
	"trait",
	"sender",
	"recipient",
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

// ── Subgraph filter clauses — operators in words ────────────────────────

const OPERATOR_WORDS: Record<string, string> = {
	eq: "is",
	neq: "is not",
	gt: "greater than",
	gte: "at least",
	lt: "less than",
	lte: "at most",
	in: "is one of",
};

/** A subgraph filter clause is either a bare value (implicit `eq`) or an
 *  `{ op: value }` object. `neq ""` reads as "is not empty" — the common
 *  "this column was ever set" filter. */
export function filterClauseWords(clause: unknown): {
	op: string;
	text: string;
} {
	if (clause === null || typeof clause !== "object" || Array.isArray(clause)) {
		return { op: "is", text: String(clause) };
	}
	const entries = Object.entries(clause as Record<string, unknown>);
	const [op, value] = entries[0] ?? ["eq", ""];
	if (op === "neq" && value === "") return { op: "is not", text: "empty" };
	if (op === "in" && Array.isArray(value)) {
		return {
			op: OPERATOR_WORDS.in ?? "is one of",
			text: value.map((v) => shortenPrincipal(String(v))).join(", "),
		};
	}
	return { op: OPERATOR_WORDS[op] ?? op, text: String(value) };
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
function perDay(count: number): number {
	return Math.round(count / 7);
}

// ── Page-level pieces: summary line + unfiltered warning + config row ──

function pluralize(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Every unfiltered chain trigger in `triggers` — a trigger with no fields
 *  set matches everything of its type, which is usually a mistake (or a
 *  very deliberate, expensive one). */
export function unfilteredTriggers(triggers: ChainTrigger[]): ChainTrigger[] {
	return triggers.filter((t) => setTriggerFields(t).length === 0);
}

/** The page's "Fires on … · See configuration" line, right under the
 *  title. */
export function ConfigSummaryLine({
	webhook,
	onOpen,
}: { webhook: WebhookDetail; onOpen: () => void }) {
	if (webhook.kind === "subgraph") {
		const filterCount = Object.keys(webhook.filter).length;
		return (
			<p className="wh-sumline">
				Fires on{" "}
				<code className="wh-chip">
					{webhook.subgraphName}.{webhook.tableName}
				</code>{" "}
				{filterCount > 0
					? `with ${pluralize(filterCount, "filter")}`
					: "with no filters"}{" "}
				·{" "}
				<button type="button" className="wh-linklike" onClick={onOpen}>
					See configuration
				</button>
			</p>
		);
	}
	const triggers = webhook.triggers ?? [];
	const filterCount = triggers.reduce(
		(sum, t) => sum + setTriggerFields(t).length,
		0,
	);
	return (
		<p className="wh-sumline">
			Fires on{" "}
			{triggers.map((t, i) => (
				// Triggers have no stable id of their own; position is fine, the
				// list never reorders under the reader.
				// biome-ignore lint/suspicious/noArrayIndexKey: triggers are static per webhook
				<code className="wh-chip" key={i}>
					{t.type}
				</code>
			))}{" "}
			· {pluralize(triggers.length, "trigger")},{" "}
			{filterCount > 0 ? pluralize(filterCount, "filter") : "no filters"} ·{" "}
			<button type="button" className="wh-linklike" onClick={onOpen}>
				See configuration
			</button>
		</p>
	);
}

/** One line per unfiltered chain trigger, always visible on the page (never
 *  only inside the card) — design 4's rule that an expensive default never
 *  hides. */
export function UnfilteredTriggerWarnings({
	webhook,
	activity,
	onOpen,
}: {
	webhook: WebhookDetail;
	activity: WebhookActivity | null;
	onOpen: () => void;
}) {
	if (webhook.kind !== "chain") return null;
	const triggers = webhook.triggers ?? [];
	const unfiltered = unfilteredTriggers(triggers);
	if (unfiltered.length === 0) return null;
	return (
		<>
			{unfiltered.map((t, i) => {
				const { count } = triggerVolume(t, triggers, activity);
				return (
					<p
						className="wh-cfg-warn-line"
						// biome-ignore lint/suspicious/noArrayIndexKey: unfiltered triggers are static per webhook
						key={i}
					>
						<i />
						<span>
							<code className="wh-mono">{t.type}</code> has no filters: about{" "}
							<b>{n(perDay(count))}</b> events a day, each a delivery and a
							billed event.{" "}
							<button type="button" className="wh-linklike" onClick={onOpen}>
								See configuration
							</button>
						</span>
					</p>
				);
			})}
		</>
	);
}

/** The bordered "Configuration · …" row after the deliveries table —
 *  replaces the old Settings block (design 4). */
export function ConfigRow({
	webhook,
	onOpen,
}: { webhook: WebhookDetail; onOpen: () => void }) {
	const auth = webhook.auth;
	const authText =
		auth.type === "bearer"
			? "Bearer token"
			: auth.type === "basic"
				? "Basic auth"
				: "No auth";
	const headerText =
		auth.headerNames.length > 0
			? ` + ${pluralize(auth.headerNames.length, "header")}`
			: "";
	const kindLabel =
		webhook.kind === "chain"
			? pluralize(webhook.triggers?.length ?? 0, "trigger")
			: `${webhook.subgraphName}.${webhook.tableName}`;
	return (
		<div className="wh-cfg-row">
			<span>Configuration</span>
			<span className="sep">·</span>
			<span>{kindLabel}</span>
			<span className="sep">·</span>
			<span className="wh-mono">{hostOf(webhook.url)}</span>
			<span className="sep">·</span>
			<span>
				{webhook.format === "standard-webhooks"
					? "Standard Webhooks"
					: "Inngest"}
			</span>
			<span className="sep">·</span>
			<span>
				{authText}
				{headerText}
			</span>
			<span className="sep">·</span>
			<span>{pluralize(webhook.maxRetries, "retry")}</span>
			<span className="sep">·</span>
			<span>{webhook.timeoutMs / 1000} s timeout</span>
			<span className="sep">·</span>
			<span>{webhook.concurrency} at once</span>
			<button type="button" className="more" onClick={onOpen}>
				Open configuration
			</button>
		</div>
	);
}

// ── The card itself ──────────────────────────────────────────────────────

type ConfigTab = "fires" | "delivery" | "json";

function TriggerCard({
	trigger,
	allTriggers,
	activity,
}: {
	trigger: ChainTrigger;
	allTriggers: ChainTrigger[];
	activity: WebhookActivity | null;
}) {
	const set = setTriggerFields(trigger);
	const unset = unsetTriggerFields(trigger);
	const { count, shared } = triggerVolume(trigger, allTriggers, activity);
	return (
		<div className="wh-tc">
			<div className="wh-tc-h">
				<div className="l">
					<span className="wh-chip">{trigger.type}</span>
					<p className="sent">{triggerSentence(trigger)}</p>
				</div>
				<div className="wh-tc-vol">
					<b>{n(count)}</b>
					matched, last 7 days
					{shared ? (
						<div className="wh-of">
							(shared with another {trigger.type} trigger)
						</div>
					) : null}
				</div>
			</div>
			{set.length > 0 ? (
				<dl className="wh-tc-fields">
					{set.map((key) => {
						const record = trigger as unknown as Record<string, unknown>;
						const value = record[key];
						const { op, text } = triggerFieldCondition(trigger, key, value);
						const long = typeof value === "string" && value.length > 24;
						return (
							<div key={key} style={{ display: "contents" }}>
								<dt>{key}</dt>
								<dd>
									<span className="op">{op}</span>
									<span className="v">{text}</span>
									{long ? (
										<CopyButton code={String(value)} label="Copy" />
									) : null}
								</dd>
							</div>
						);
					})}
				</dl>
			) : null}
			{unset.length > 0 && set.length > 0 ? (
				<p className="wh-tc-any">Not filtered: {unset.join(", ")}</p>
			) : null}
			{set.length === 0 ? (
				<p className="wh-tc-warn">
					<i />
					<span>
						No filters, so this matches every {TRIGGER_NOUN[trigger.type]} on
						chain: about <b>{n(perDay(count))}</b> events a day. Each one is a
						delivery and a billed event. Add a sender, recipient or amount to
						narrow it.
					</span>
				</p>
			) : null}
		</div>
	);
}

function SubgraphFireCard({
	webhook,
	activity,
}: { webhook: WebhookDetail; activity: WebhookActivity | null }) {
	const keys = Object.keys(webhook.filter);
	// A subgraph webhook fires on one table; every outbox row for it counts,
	// whatever the created/updated/deleted op — "sum all event types for the
	// webhook" (design 5).
	const count = activity
		? Object.values(activity.byEventType).reduce((a, b) => a + b, 0)
		: 0;
	return (
		<div className="wh-tc">
			<div className="wh-tc-h">
				<div className="l">
					<span className="wh-chip">
						{webhook.subgraphName}.{webhook.tableName}
					</span>
					<p className="sent">
						New rows in <b>{webhook.tableName}</b> from your subgraph{" "}
						<b>{webhook.subgraphName}</b> that match every filter
					</p>
				</div>
				<div className="wh-tc-vol">
					<b>{n(count)}</b>
					matched, last 7 days
				</div>
			</div>
			{keys.length > 0 ? (
				<dl className="wh-tc-fields">
					{keys.map((key) => {
						const { op, text } = filterClauseWords(webhook.filter[key]);
						return (
							<div key={key} style={{ display: "contents" }}>
								<dt>{key}</dt>
								<dd>
									<span className="op">{op}</span>
									<span className="v">{text}</span>
								</dd>
							</div>
						);
					})}
				</dl>
			) : null}
		</div>
	);
}

function DeliveryFacts({ webhook }: { webhook: WebhookDetail }) {
	const auth = webhook.auth;
	return (
		<dl className="wh-facts">
			<dt>Sends to</dt>
			<dd style={{ display: "flex", gap: 8, alignItems: "center" }}>
				<span className="wh-mono">{webhook.url}</span>
				<CopyButton code={webhook.url} label="Copy" />
			</dd>
			<dt>Format</dt>
			<dd>{FORMAT_LABEL[webhook.format]}</dd>
			<dt>Auth</dt>
			<dd>
				{auth.type === "bearer"
					? "Bearer token "
					: auth.type === "basic"
						? "Basic auth "
						: "None"}
				{auth.type !== "none" ? <em>(set, hidden)</em> : null}
				{auth.headerNames.length > 0 ? (
					<>
						, extra headers{" "}
						{auth.headerNames.map((h) => (
							<span className="wh-chip" key={h} style={{ marginRight: 4 }}>
								{h}
							</span>
						))}{" "}
						<em>(values hidden)</em>
					</>
				) : null}
			</dd>
			<dt>Retries</dt>
			<dd>
				<span className="wh-mono">{webhook.maxRetries}</span>{" "}
				<span className="wh-of">of 7 allowed</span>
			</dd>
			<dt>Timeout</dt>
			<dd>
				<span className="wh-mono">{webhook.timeoutMs / 1000}</span> seconds{" "}
				<span className="wh-of">of 30 allowed</span>
			</dd>
			<dt>In flight</dt>
			<dd>
				<span className="wh-mono">{webhook.concurrency}</span>{" "}
				<span className="wh-of">requests at once</span>
			</dd>
		</dl>
	);
}

function configJson(webhook: WebhookDetail): string {
	const body: Record<string, unknown> =
		webhook.kind === "chain"
			? { triggers: webhook.triggers }
			: {
					subgraph: webhook.subgraphName,
					table: webhook.tableName,
					filter: webhook.filter,
				};
	body.url = webhook.url;
	body.format = webhook.format;
	if (webhook.runtime) body.runtime = webhook.runtime;
	body.maxRetries = webhook.maxRetries;
	body.timeoutMs = webhook.timeoutMs;
	body.concurrency = webhook.concurrency;
	return prettyJson(body);
}

export function ConfigCard({
	webhook,
	activity,
	tab,
	onTabChange,
	onClose,
}: {
	webhook: WebhookDetail | null;
	activity: WebhookActivity | null;
	tab: ConfigTab;
	onTabChange: (tab: ConfigTab) => void;
	onClose: () => void;
}) {
	if (!webhook) return null;
	const triggers = webhook.triggers ?? [];
	return (
		<FloatingCard
			open={webhook !== null}
			onClose={onClose}
			title="Configuration"
			subtitle={`${webhook.name} · edit with the CLI or SDK`}
		>
			<div className="wh-tabs" role="tablist" style={{ marginTop: 0 }}>
				<button
					type="button"
					role="tab"
					aria-selected={tab === "fires"}
					onClick={() => onTabChange("fires")}
				>
					Fires on
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === "delivery"}
					onClick={() => onTabChange("delivery")}
				>
					Delivery
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === "json"}
					onClick={() => onTabChange("json")}
				>
					JSON
				</button>
			</div>
			{tab === "fires" ? (
				<>
					{webhook.kind === "chain" && triggers.length > 1 ? (
						<p className="wh-cfg-rule">
							Sends a delivery when <b>any</b> trigger matches. Inside a
							trigger, <b>every</b> listed field must match.
						</p>
					) : null}
					{webhook.kind === "chain" ? (
						triggers.map((t, i) => (
							<TriggerCard
								// biome-ignore lint/suspicious/noArrayIndexKey: triggers are static per webhook
								key={i}
								trigger={t}
								allTriggers={triggers}
								activity={activity}
							/>
						))
					) : (
						<SubgraphFireCard webhook={webhook} activity={activity} />
					)}
					<p className="acct-fine">
						Created {formatDate(webhook.createdAt)}. Blocks while the webhook is
						paused are skipped; replay a range with{" "}
						<code>secondlayer webhooks replay</code>.
					</p>
				</>
			) : null}
			{tab === "delivery" ? (
				<>
					<DeliveryFacts webhook={webhook} />
					<CliLine command={`secondlayer webhooks update ${webhook.id}`} />
				</>
			) : null}
			{tab === "json" ? (
				<CodePanel
					label="webhook config · as the CLI and SDK see it"
					code={configJson(webhook)}
					lang="json"
					emptyText=""
				/>
			) : null}
		</FloatingCard>
	);
}
