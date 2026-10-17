import type { ChainTrigger, WebhookDetail } from "@secondlayer/sdk";
import { shortenPrincipal } from "./shared";
import { SENTENCE_FIELD_ORDER, TRIGGER_NOUN } from "./triggers";

/**
 * One pure generator that turns any chain trigger into its row line, focus
 * prose, annotated code and the "Copy for agent" prompt. Deterministic: no
 * model, no React. Every piece of text a webhook shows about its triggers
 * comes from here so phrasing can't drift between surfaces.
 */

/** A run of text; `code` renders it as inline code. */
export type Piece = { text: string; code?: boolean };
/** A phrase of the sentence. With `focus`, it is a focus link to the rows carrying that ref. */
export type Segment = { pieces: Piece[]; focus?: string };
export type TriggerDescription = {
	/** The row's one-liner: "Print events from pox-5 where signer is one of these 2 contracts". */
	line: Piece[];
	/** "Fires on every …" as segments, then the closing ".". */
	prose: Segment[];
	/** Plain sentences after the prose: the sibling sentence or the cost sentence. */
	tail: string;
	/** The trigger's lines with `// !ref` annotation comments. */
	source: string;
};

type Fields = Record<string, unknown>;
type Phrase = Piece[];

/** The most phrases that become focus links; the rest fold into one. */
const MAX_FOCUS = 4;
/** Two where-values read inline only while "a or b" stays this short. */
const INLINE_LIST_LIMIT = 40;

const text = (value: string): Piece => ({ text: value });
const code = (value: string): Piece => ({ text: value, code: true });
const plain = (pieces: Piece[]): string => pieces.map((p) => p.text).join("");

// ── Value formatting ──────────────────────────────────────────────────────

const PRINCIPAL = /^S[PMTN][0-9A-Z]{20,}/;
const isPrincipal = (value: string): boolean => PRINCIPAL.test(value);
const SBTC_ASSET = /\.sbtc-token(::|$)/;

/** Short form of a Bitcoin address or txid: first 6, last 4. */
function shortHash(value: string): string {
	return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

/** Contract principal -> contract name; standard principal -> short address. */
function principalName(value: string): string {
	const dot = value.indexOf(".");
	return dot > 0 ? value.slice(dot + 1) : shortenPrincipal(value);
}

/** A name that may carry a `*` wildcard: plain prose when wildcarded, code when exact. */
function pattern(value: string, kind: string): Piece {
	if (!value.includes("*")) return code(principalName(value));
	const afterAddress = value.includes(".")
		? value.slice(value.indexOf(".") + 1)
		: value;
	const prefix = afterAddress.split("*")[0] ?? "";
	return text(prefix ? `any ${kind} starting with ${prefix}` : `any ${kind}`);
}

function token(assetIdentifier: string): string {
	if (SBTC_ASSET.test(assetIdentifier)) return "sBTC";
	const [contract = "", asset] = assetIdentifier.split("::");
	return asset || principalName(contract);
}

function isSbtc(trigger: Fields): boolean {
	return (
		String(trigger.type).startsWith("sbtc_") ||
		SBTC_ASSET.test(String(trigger.assetIdentifier ?? ""))
	);
}

function formatNumber(value: number, maxFraction: number): string {
	return value.toLocaleString("en-US", { maximumFractionDigits: maxFraction });
}

/** An amount split into number and unit so a range can drop the first unit. */
function amount(
	trigger: Fields,
	raw: unknown,
): { value: string; unit: string } {
	const n = Number(raw);
	if (String(trigger.type).startsWith("stx_"))
		return { value: formatNumber(n / 1e6, 6), unit: "STX" };
	if (isSbtc(trigger)) return { value: formatNumber(n / 1e8, 8), unit: "sBTC" };
	return { value: formatNumber(n, 0), unit: "base units" };
}

const amountText = (a: { value: string; unit: string }): string =>
	`${a.value} ${a.unit}`;

function amountPhrase(trigger: Fields): string {
	const { minAmount: min, maxAmount: max } = trigger;
	if (min !== undefined && max !== undefined)
		return `between ${amount(trigger, min).value} and ${amountText(amount(trigger, max))}`;
	if (min !== undefined) return `${amountText(amount(trigger, min))} or more`;
	return `${amountText(amount(trigger, max))} or less`;
}

/** One value inline, two when they stay short, else a count. */
function listPieces(values: string[]): Piece[] {
	const formatted = values.map((v) => (isPrincipal(v) ? principalName(v) : v));
	const [first, second] = formatted;
	if (first !== undefined && formatted.length === 1) return [code(first)];
	if (
		first !== undefined &&
		second !== undefined &&
		formatted.length === 2 &&
		`${first} or ${second}`.length <= INLINE_LIST_LIMIT
	)
		return [code(first), text(" or "), code(second)];
	const kind = values.every(isPrincipal) ? "contracts" : "values";
	return [text(`one of these ${values.length} ${kind}`)];
}

// ── Phrase table ──────────────────────────────────────────────────────────

const str = (value: unknown): string => String(value);

const PHRASES: Record<string, (trigger: Fields, value: unknown) => Phrase> = {
	assetIdentifier: (_t, v) => [text("of "), code(token(str(v)))],
	contractId: (t, v) => [
		text(
			`${t.type === "print_event" ? "from" : /call/.test(str(t.type)) ? "to" : "on"} `,
		),
		pattern(str(v), "contract"),
	],
	deployer: (_t, v) => [text("by "), pattern(str(v), "address")],
	contractName: (_t, v) =>
		str(v).includes("*")
			? [text(`with a name starting with ${str(v).split("*")[0]}`)]
			: [text("named "), code(str(v))],
	functionName: (_t, v) => [text("calling "), pattern(str(v), "function")],
	caller: (_t, v) => [text("made by "), pattern(str(v), "contract")],
	varName: (_t, v) => [text("to "), code(str(v))],
	map: (_t, v) => [text("to map "), code(str(v))],
	topic: (_t, v) => [text("with topic "), code(str(v))],
	lockedAddress: (_t, v) => [text("by "), pattern(str(v), "address")],
	bitcoinTxid: (_t, v) => [text("from Bitcoin tx "), code(shortHash(str(v)))],
	sweepTxid: (_t, v) => [text("in Bitcoin tx "), code(shortHash(str(v)))],
	requestId: (_t, v) => [text("for request "), code(`#${str(v)}`)],
	trait: (_t, v) => [text("on any contract implementing "), code(str(v))],
	sender: (t, v) => [
		text(/burn|sbtc_/.test(str(t.type)) ? "from " : "sent by "),
		pattern(str(v), "address"),
	],
	recipient: (_t, v) => [text("to "), pattern(str(v), "address")],
	rune: (_t, v) => [text("of "), code(str(v))],
	address: (_t, v) => [text("to "), code(shortHash(str(v)))],
};

/** `with {field} {value}`: what an unknown field renders as. */
const fallbackPhrase = (field: string, value: unknown): Phrase => [
	text("with "),
	code(field),
	text(" "),
	code(str(value)),
];

// ── Describe ──────────────────────────────────────────────────────────────

type Part = {
	/** Focus ref; the code rows of `fields` carry it. */
	ref: string;
	phrase: Phrase;
	/** Source fields this phrase covers (`where.{key}` for where keys). */
	fields: string[];
};

const nounOf = (type: string): string =>
	type === "print_event"
		? "print event"
		: ((TRIGGER_NOUN as Record<string, string>)[type] ?? type);

function plural(noun: string): string {
	const base = /^[a-z][A-Z]/.test(noun)
		? noun
		: `${noun.charAt(0).toUpperCase()}${noun.slice(1)}`;
	return `${base}s`;
}

function setKeys(trigger: Fields): string[] {
	const keys = Object.keys(trigger).filter(
		(k) => k !== "type" && trigger[k] !== undefined,
	);
	const known = SENTENCE_FIELD_ORDER.filter((k) => keys.includes(k));
	const unknown = keys.filter(
		(k) => !(SENTENCE_FIELD_ORDER as readonly string[]).includes(k),
	);
	return [...known, ...unknown];
}

function buildParts(trigger: Fields, keys: string[]): Part[] {
	const parts: Part[] = [];
	const hasMin = trigger.minAmount !== undefined;
	const hasMax = trigger.maxAmount !== undefined;
	const hasAmount = hasMin || hasMax;
	const unitField =
		trigger.assetIdentifier !== undefined
			? "assetIdentifier"
			: trigger.rune !== undefined
				? "rune"
				: null;
	const amountFields = ["minAmount", "maxAmount"].filter((k) =>
		keys.includes(k),
	);
	for (const key of keys) {
		const value = trigger[key];
		if (key === "where") {
			Object.entries(value as Record<string, string | string[]>).forEach(
				([whereKey, whereValue], i) => {
					parts.push({
						ref: `where.${whereKey}`,
						fields: [`where.${whereKey}`],
						phrase: [
							text(i === 0 ? "where " : "and "),
							code(whereKey),
							text(" is "),
							...listPieces([whereValue].flat().map(str)),
						],
					});
				},
			);
			continue;
		}
		if (key === "minAmount" || key === "maxAmount") {
			if (unitField) continue; // merged into the asset or rune phrase
			if (key === "maxAmount" && hasMin) continue; // range handled at min
			parts.push({
				ref: hasMin && hasMax ? "amount" : key,
				fields: amountFields,
				phrase: [
					text(
						hasMin && hasMax
							? amountPhrase(trigger)
							: `of ${amountPhrase(trigger)}`,
					),
				],
			});
			continue;
		}
		if (key === unitField && hasAmount) {
			const name = key === "rune" ? str(value) : token(str(value));
			const amountPart = amountPhrase(trigger);
			const sbtc = isSbtc(trigger);
			const phrase: Phrase = sbtc
				? [
						text(
							amountPart.startsWith("between")
								? amountPart
								: `of ${amountPart}`,
						),
					]
				: [text("of "), code(name), text(`, ${amountPart}`)];
			parts.push({ ref: key, fields: [key, ...amountFields], phrase });
			continue;
		}
		const build = PHRASES[key];
		parts.push({
			ref: key,
			fields: [key],
			phrase: build ? build(trigger, value) : fallbackPhrase(key, value),
		});
	}
	return parts;
}

function siblingTail(
	trigger: Fields,
	index: number,
	all: readonly Fields[],
): string {
	const own = (k: string) => k !== "type";
	const sentences: string[] = [];
	all.forEach((other, j) => {
		if (j === index || other.type !== trigger.type) return;
		const keys = new Set([
			...Object.keys(trigger).filter(own),
			...Object.keys(other).filter(own),
		]);
		const diff = [...keys].filter(
			(k) => JSON.stringify(trigger[k]) !== JSON.stringify(other[k]),
		);
		if (diff.length < 1 || diff.length > 2) return;
		const a = trigger.where as Record<string, unknown> | undefined;
		const b = other.where as Record<string, unknown> | undefined;
		const sameValuesNewKey =
			a &&
			b &&
			JSON.stringify(Object.values(a)) === JSON.stringify(Object.values(b)) &&
			Object.keys(a).join() !== Object.keys(b).join();
		sentences.push(
			sameValuesNewKey
				? `Trigger ${j + 1} is the same, but checks ${Object.keys(b).join(" and ")}.`
				: `Trigger ${j + 1} is the same, but with ${diff.join(" and ")} changed.`,
		);
	});
	return sentences.join(" ");
}

// ── Source ────────────────────────────────────────────────────────────────

const HELPERS = new Set([
	"stx_transfer",
	"stx_mint",
	"stx_burn",
	"stx_lock",
	"ft_transfer",
	"ft_mint",
	"ft_burn",
	"nft_transfer",
	"nft_mint",
	"nft_burn",
	"contract_call",
	"contract_deploy",
	"print_event",
	"sbtc_deposit",
	"sbtc_withdrawal_create",
	"sbtc_withdrawal_accept",
	"sbtc_withdrawal_reject",
	"sbtc_withdrawal_swept_confirmed",
	"rune_etch",
	"rune_mint",
	"rune_transfer",
	"rune_burn",
]);

const camel = (type: string): string =>
	type.replace(/_(\w)/g, (_, ch: string) => ch.toUpperCase());

const objectKey = (key: string): string =>
	/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);

type Row = { line: string; ref: string | null };

/** The trigger's code lines, each tagged with the field ref it belongs to. */
function sourceRows(trigger: Fields, refOf: (field: string) => string): Row[] {
	const { type, ...rest } = trigger;
	const keys = Object.keys(rest).filter((k) => rest[k] !== undefined);
	const helper = HELPERS.has(str(type));
	const rows: Row[] = [];
	const add = (line: string, ref: string | null = null) =>
		rows.push({ line, ref });
	if (helper && !keys.length)
		return [{ line: `    trigger.${camel(str(type))}(),`, ref: null }];
	if (helper) add(`    trigger.${camel(str(type))}({`);
	else {
		add("    {");
		add(`      type: ${JSON.stringify(type)},`);
	}
	for (const key of keys) {
		const value = rest[key];
		if (key !== "where") {
			add(`      ${objectKey(key)}: ${JSON.stringify(value)},`, refOf(key));
			continue;
		}
		add("      where: {");
		for (const [whereKey, whereValue] of Object.entries(
			value as Record<string, string | string[]>,
		)) {
			const ref = refOf(`where.${whereKey}`);
			if (Array.isArray(whereValue)) {
				add(`        ${objectKey(whereKey)}: [`, ref);
				for (const v of whereValue) add(`          ${JSON.stringify(v)},`, ref);
				add("        ],", ref);
			} else
				add(
					`        ${objectKey(whereKey)}: ${JSON.stringify(whereValue)},`,
					ref,
				);
		}
		add("      },");
	}
	add(helper ? "    })," : "    },");
	return rows;
}

/** Inserts `// !ref(1:n)` comments above each run of rows sharing a ref. */
function annotate(rows: Row[], folded: ReadonlySet<string>): string {
	const out: string[] = [];
	for (let i = 0; i < rows.length; ) {
		const row = rows[i] as Row;
		if (row.ref === null) {
			out.push(row.line);
			i++;
			continue;
		}
		let n = 1;
		while (rows[i + n]?.ref === row.ref) n++;
		const indent = /^ */.exec(row.line)?.[0] ?? "";
		const refs = folded.has(row.ref) ? [row.ref, "more"] : [row.ref];
		for (const ref of refs) out.push(`${indent}// !ref(1:${n}) ${ref}`);
		for (let k = 0; k < n; k++) out.push((rows[i + k] as Row).line);
		i += n;
	}
	return out.join("\n");
}

// ── Public API ────────────────────────────────────────────────────────────

export function describeTrigger(
	trigger: ChainTrigger,
	index: number,
	all: readonly ChainTrigger[],
	perDay?: number,
): TriggerDescription {
	const fields = trigger as Fields;
	const noun = nounOf(str(fields.type));
	const siblings = siblingTail(fields, index, all as readonly Fields[]);
	const keys = setKeys(fields);

	if (!keys.length) {
		const cost = `No filters, so each one is delivered and billed${
			perDay ? `: about ${perDay.toLocaleString("en-US")} a day` : ""
		}.`;
		return {
			line: [text(`Every ${noun} on chain`)],
			prose: [{ pieces: [text(`Fires on every ${noun} on chain.`)] }],
			tail: [cost, siblings].filter(Boolean).join(" "),
			source: annotate(
				sourceRows(fields, (f) => f),
				new Set(),
			),
		};
	}

	const parts = buildParts(fields, keys);
	const refByField = new Map<string, string>();
	for (const part of parts)
		for (const field of part.fields) refByField.set(field, part.ref);

	const line: Piece[] = [text(plural(noun))];
	for (const part of parts) line.push(text(" "), ...part.phrase);

	const focused: { ref: string; phrase: Phrase }[] =
		parts.length > MAX_FOCUS
			? [
					...parts.slice(0, MAX_FOCUS - 1),
					{
						ref: "more",
						phrase: [
							text(`and ${parts.length - (MAX_FOCUS - 1)} more conditions`),
						],
					},
				]
			: parts;
	const folded = new Set(
		parts.length > MAX_FOCUS
			? parts.slice(MAX_FOCUS - 1).map((p) => p.ref)
			: [],
	);

	const prose: Segment[] = [{ pieces: [text(`Fires on every ${noun}`)] }];
	for (const { ref, phrase } of focused)
		prose.push({ pieces: [text(" ")] }, { pieces: phrase, focus: ref });
	prose.push({ pieces: [text(".")] });

	return {
		line,
		prose,
		tail: siblings,
		source: annotate(
			sourceRows(fields, (f) => refByField.get(f) ?? f),
			folded,
		),
	};
}

const CALL_HEAD = [
	'import { trigger } from "@secondlayer/sdk";',
	"",
	"await sl.webhooks.create({",
];

/** The full create call with no annotations, and where each trigger starts (1-based line). */
export function webhookSource(
	webhook: Pick<WebhookDetail, "name" | "url" | "triggers">,
): { text: string; starts: number[] } {
	const lines = [
		...CALL_HEAD,
		`  name: ${JSON.stringify(webhook.name)},`,
		`  url: ${JSON.stringify(webhook.url)},`,
		"  triggers: [",
	];
	const starts: number[] = [];
	for (const t of webhook.triggers) {
		starts.push(lines.length + 1);
		for (const row of sourceRows(t as Fields, (f) => f)) lines.push(row.line);
	}
	lines.push("  ],", "});");
	return { text: lines.join("\n"), starts };
}

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

function utcDate(iso: string): string {
	const d = new Date(iso);
	return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function utcDateTime(iso: string): string {
	const d = new Date(iso);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** The "Copy for agent" kick-off prompt. */
export function agentPrompt(
	webhook: WebhookDetail,
	stacksHeight: number | null,
): string {
	const { id, name, triggers } = webhook;
	const lines = triggers.map(
		(t, i) =>
			`${i + 1}. ${t.type}: ${plain(describeTrigger(t, i, triggers).line)}`,
	);
	return `I want to change my Secondlayer webhook "${name}". Ask me what I want to change before you run anything.

Webhook
- id: ${id}
- name: ${name}
- url: ${webhook.url}
- status: ${webhook.status} · format: ${webhook.format} · retries: ${webhook.maxRetries} · timeout: ${webhook.timeoutMs} ms · concurrency: ${webhook.concurrency}
- created: ${utcDate(webhook.createdAt)} · last delivery: ${webhook.lastDeliveryAt ? utcDateTime(webhook.lastDeliveryAt) : "none yet"}
- Stacks height when copied: ${stacksHeight === null ? "unknown" : stacksHeight.toLocaleString("en-US")}

Triggers${triggers.length > 1 ? " (either one fires)" : ""}
${lines.join("\n")}

Current triggers as JSON (works with the CLI --triggers-file, the SDK and MCP):
${JSON.stringify(triggers, null, 2)}

How changes work
- URL, auth, retries, timeout, concurrency and name change in place: secondlayer webhooks update ${id} (or MCP webhooks_update).
- Triggers can't change in place. Changing them means creating a new webhook and deleting this one:
  - Names are unique: pick a new name, or delete this one first.
  - The new webhook gets a new signing secret, shown once. The receiver must switch to it.
  - Events that land between the delete and the create can be sent with secondlayer webhooks replay <name> --from-block <n> --to-block <n>.
- Before creating a new trigger, check what it matches: MCP index_print_schema or index_discover, then secondlayer webhooks test.

Tools
- MCP (@secondlayer/mcp): webhooks_get, webhooks_update, webhooks_create, webhooks_delete, webhooks_replay, index_print_schema
- CLI: secondlayer webhooks get | update | create | delete | replay | doctor | test
- Skill: bunx skills add ryanwaits/secondlayer --skill secondlayer -y
- Docs: https://www.secondlayer.tools/docs/webhooks

Start by asking me what should change. Then propose the steps, including any secret switch or replay, and wait for my go before running a command.
`;
}
