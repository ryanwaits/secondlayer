import {
	CHAIN_TRIGGER_FIELDS,
	CHAIN_TRIGGER_TYPES,
	WEBHOOK_FORMATS,
	WEBHOOK_STATUSES,
} from "@secondlayer/shared/schemas/webhooks";
import {
	ERROR_400,
	WRITE_SECURITY,
	apiReadResponses,
	json200,
	jsonBody,
	jsonError,
	pp,
	qp,
	writeResponses,
} from "./shared.ts";

/**
 * Webhooks (`src/routes/webhooks.ts`). Request shapes come from
 * `@secondlayer/shared/schemas/webhooks` (the Zod schemas the route parses
 * with); response shapes from the route's `toSummary` / `toDetail` and the
 * inline deliveries / dead-letter mappers.
 */

const ID_PARAM = pp("id", "Webhook id (UUID), as returned by create or list.");

const NOT_FOUND = jsonError("No webhook with this id");

// `writeResponses` leads with a generic 200. Create and replay answer with
// 201 / 202 instead, so drop it and let the real status be the success code.
function writeResponsesWithout200(extra: Record<string, unknown>) {
	const { "200": _unused, ...rest } = writeResponses(extra);
	return rest;
}

// Mirrors `WebhookKind` in `@secondlayer/shared/schemas/webhooks` (a TS union,
// no runtime constant).
const WEBHOOK_KINDS = ["chain"];

const SUBGRAPH_WEBHOOKS_REMOVED_NOTE =
	"A body carrying `subgraphName`, `tableName` or `filter` is answered with `SUBGRAPH_WEBHOOKS_REMOVED`: subgraph webhooks were removed";

// ── Example values (fake ids; block, tx and principals from mainnet) ──

const EXAMPLE_ID = "3f1c2a9e-8b7d-4c21-9a55-6e0d4b2f7c18";
// Real secrets are 64 hex chars (`generateSecret` in shared/crypto/hmac.ts).
const FAKE_SECRET =
	"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const EXAMPLE_TX =
	"0x839ef4720020f5aba341630e8965851f8537bc8fc99a856091093780c886a8be";
const SBTC_TOKEN =
	"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";

const EXAMPLE_TRIGGERS = [
	{
		type: "ft_transfer",
		assetIdentifier: SBTC_TOKEN,
		minAmount: "100000",
	},
	{
		type: "print_event",
		contractId: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry",
	},
];

const EXAMPLE_SUMMARY = {
	id: EXAMPLE_ID,
	name: "sbtc-moves",
	status: "active",
	kind: "chain",
	format: "standard-webhooks",
	url: "https://example.com/webhooks/sbtc",
	lastDeliveryAt: "2026-09-22T14:03:11.402Z",
	lastSuccessAt: "2026-09-22T14:03:11.402Z",
	circuitOpenedAt: null,
	circuitFailures: 0,
	managedBy: null,
	createdAt: "2026-09-20T09:12:45.118Z",
	updatedAt: "2026-09-20T09:12:45.118Z",
};

const EXAMPLE_DETAIL = {
	...EXAMPLE_SUMMARY,
	triggers: EXAMPLE_TRIGGERS,
	auth: { type: "none", headerNames: [], hasSecret: false },
	maxRetries: 7,
	timeoutMs: 10000,
	concurrency: 4,
	lastError: null,
	receiverCertExpiresAt: "2026-12-25T22:56:35.000Z",
	warning: null,
};

const EXAMPLE_DEAD = {
	id: "5e8d3b17-a2c4-4f90-b6e1-7d0c29f4a853",
	eventType: "chain.ft_transfer.apply",
	attempt: 7,
	blockHeight: 8700076,
	txId: EXAMPLE_TX,
	payload: {
		action: "apply",
		block_hash:
			"0xf9ff01e876f9276abc9f0fc79a4fbefc500bf2b93ed1effd0ef637ef84e10604",
		block_height: 8700076,
		block_time: "2026-05-01T11:59:48.000Z",
		tx_id: EXAMPLE_TX,
		canonical: true,
		trigger: "ft_transfer",
		event: {
			tx_id: EXAMPLE_TX,
			type: "ft_transfer_event",
			event_index: 45,
			data: {
				amount: "764749",
				sender:
					"SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-stx-sbtc-v-1-bps-15",
				recipient: "SP1GBRTAXY96ZDYRQY4GR0M9JTXVYD2FGFRGV60FJ",
				asset_identifier: SBTC_TOKEN,
			},
		},
	},
	failedAt: "2026-09-22T16:41:02.877Z",
	createdAt: "2026-09-22T14:03:10.915Z",
};

const OK_SCHEMA = {
	type: "object",
	required: ["ok"],
	properties: {
		ok: { type: "boolean", description: "Always `true`." },
	},
	example: { ok: true },
};

// ── Shared property sets ──────────────────────────────────────────────

const FORMAT_PROP = {
	type: "string",
	enum: [...WEBHOOK_FORMATS],
	description:
		"Payload and signing format. `standard-webhooks` signs with the webhook's secret; the others shape the body for that receiver.",
};

const SUMMARY_PROPERTIES = {
	id: { type: "string", format: "uuid", description: "Webhook id." },
	name: {
		type: "string",
		description: "Unique name on this instance.",
	},
	status: {
		type: "string",
		enum: [...WEBHOOK_STATUSES],
		description:
			"`active` delivers. `paused` holds new events in the outbox until resumed; the circuit breaker also pauses a webhook after 20 straight failures. `error` is reserved; nothing sets it today.",
	},
	kind: {
		type: "string",
		enum: WEBHOOK_KINDS,
		description:
			"Always `chain`: webhooks fire on raw chain events matched by `triggers`.",
	},
	format: FORMAT_PROP,
	url: { type: "string", description: "Delivery target." },
	lastDeliveryAt: {
		type: ["string", "null"],
		format: "date-time",
		description: "Last delivery attempt, successful or not.",
	},
	lastSuccessAt: {
		type: ["string", "null"],
		format: "date-time",
		description: "Last delivery the target answered with a 2xx.",
	},
	circuitOpenedAt: {
		type: ["string", "null"],
		format: "date-time",
		description:
			"When the circuit breaker paused this webhook. Cleared on resume.",
	},
	circuitFailures: {
		type: "integer",
		description:
			"Consecutive failed deliveries; a success resets it. The circuit opens at 20; resume resets it.",
	},
	managedBy: {
		type: ["string", "null"],
		description:
			"Product that owns this webhook's name, derived from a reserved name prefix (for example `sentinel:` is Sentinel). When set, renaming returns 409 `WEBHOOK_NAME_MANAGED`. `null` for ordinary webhooks.",
	},
	createdAt: {
		type: "string",
		format: "date-time",
		description: "When the webhook was created.",
	},
	updatedAt: {
		type: "string",
		format: "date-time",
		description: "Last config or status change.",
	},
};

// Response-only: the redacted shape `toDetail` returns for `auth_config`.
// Never the request shape — create/update still take `authConfig` (see
// `TUNING_PROPS` below), it's just never echoed back.
const AUTH_PROP = {
	type: "object",
	required: ["type", "headerNames", "hasSecret"],
	description:
		"Receiver credentials, redacted — set with `authConfig` on create or update, but never returned. `authConfig` is write-only.",
	properties: {
		type: {
			type: "string",
			enum: ["bearer", "basic", "none"],
			description: "Auth scheme the receiver expects.",
		},
		headerNames: {
			type: "array",
			items: { type: "string" },
			description:
				"Names of extra headers sent with each delivery. Values are never returned.",
		},
		hasSecret: {
			type: "boolean",
			description:
				"True when a bearer token or basic-auth string is set. The value itself is never returned.",
		},
	},
};

// Request-only: accepted by create/update, never returned by a read (see
// `AUTH_PROP` above for what a read gets instead).
const TUNING_PROPS = {
	authConfig: {
		type: "object",
		additionalProperties: true,
		description:
			"Per-format receiver credentials: `token` / `tokenEnc` for `trigger` and `cloudflare`, `headers` or `basicAuth` for `raw`. Write-only — never returned; a read gets `auth` instead.",
	},
	maxRetries: {
		type: "integer",
		minimum: 0,
		maximum: 100,
		description:
			"Attempts before an event moves to the dead-letter queue. Default 7.",
	},
	timeoutMs: {
		type: "integer",
		minimum: 100,
		maximum: 300000,
		description: "Per-attempt HTTP timeout in milliseconds. Default 10000.",
	},
	concurrency: {
		type: "integer",
		minimum: 1,
		maximum: 100,
		description: "Deliveries in flight at once for this webhook. Default 4.",
	},
};

const DETAIL_PROPERTIES = {
	...SUMMARY_PROPERTIES,
	triggers: {
		type: "array",
		items: { $ref: "#/components/schemas/ChainTrigger" },
		description: "Chain triggers.",
	},
	auth: AUTH_PROP,
	maxRetries: TUNING_PROPS.maxRetries,
	timeoutMs: TUNING_PROPS.timeoutMs,
	concurrency: TUNING_PROPS.concurrency,
	lastError: {
		type: ["string", "null"],
		description: "Error from the last failed delivery.",
	},
	receiverCertExpiresAt: {
		type: ["string", "null"],
		format: "date-time",
		description:
			"When the receiver's TLS certificate expires, from a periodic probe. `null` for http receivers, unreachable hosts, and webhooks not probed yet.",
	},
	warning: {
		type: ["string", "null"],
		description:
			"Set when this instance's chain-trigger evaluator isn't running (`SUBGRAPH_SOURCE` != `streams-index`) — the webhook will never fire until that's fixed. `null` otherwise.",
	},
};

/** Every trigger field, described with the types that accept it (derived
 *  from the validator's own per-type field list, so it cannot drift). */
const TRIGGER_FIELD_TEXT: Record<string, string> = {
	sender: "Sender principal. `*` wildcards allowed.",
	recipient: "Recipient principal. `*` wildcards allowed.",
	minAmount:
		"Minimum amount, inclusive. Integer string (uint128-safe) or number.",
	maxAmount:
		"Maximum amount, inclusive. Integer string (uint128-safe) or number.",
	lockedAddress: "Principal whose STX is locked. `*` wildcards allowed.",
	assetIdentifier:
		"Asset identifier, `<contract>::<asset>`. `*` wildcards allowed.",
	trait: "Match only contracts that implement this trait (e.g. `sip-010`).",
	contractId: "Contract principal. `*` wildcards allowed.",
	functionName: "Function name. `*` wildcards allowed (e.g. `swap-*`).",
	caller: "Calling principal. `*` wildcards allowed.",
	deployer: "Deploying principal. `*` wildcards allowed.",
	contractName: "Deployed contract name. `*` wildcards allowed.",
	topic: "Print topic. `*` wildcards allowed.",
	varName: "Data-var name. `*` wildcards allowed.",
	map: "Map name. `*` wildcards allowed.",
	bitcoinTxid: "Bitcoin txid of the deposit.",
	requestId: "sBTC request id.",
	sweepTxid: "Bitcoin txid of the sweep.",
	rune: 'A RuneRef: an id ("840000:3") or a name ("DOG•GO•TO•THE•MOON"), spacer- and case-insensitive. Normalized to its canonical id on create; an unknown rune is rejected with 400.',
	address: "Bitcoin (mainnet) address. Exact match, no wildcards.",
};

const TRIGGER_AMOUNT = {
	oneOf: [
		{ type: "string", pattern: "^\\d+$" },
		{ type: "integer", minimum: 0 },
	],
};

/**
 * Trigger types fed by the node's opt-in `storage` / `contract_calls` observer
 * keys, which only an unreleased stacks-core fork emits. The validator accepts
 * them; the public reference doesn't advertise them until that node ships.
 */
const UNRELEASED_TRIGGER_TYPES: ReadonlySet<string> = new Set([
	"nested_contract_call",
	"var_set",
	"map_set",
	"map_insert",
	"map_delete",
]);

const PUBLIC_TRIGGER_TYPES = CHAIN_TRIGGER_TYPES.filter(
	(t) => !UNRELEASED_TRIGGER_TYPES.has(t),
);

const PUBLIC_TRIGGER_FIELDS = Object.fromEntries(
	Object.entries(CHAIN_TRIGGER_FIELDS).filter(
		([type]) => !UNRELEASED_TRIGGER_TYPES.has(type),
	),
);

function triggerFieldSchema(field: string): Record<string, unknown> {
	const types = Object.entries(PUBLIC_TRIGGER_FIELDS)
		.filter(([, fields]) => fields.includes(field))
		.map(([type]) => `\`${type}\``);
	const base =
		field === "minAmount" || field === "maxAmount"
			? TRIGGER_AMOUNT
			: field === "requestId"
				? { type: "integer", minimum: 0 }
				: { type: "string" };
	return {
		...base,
		description: `${TRIGGER_FIELD_TEXT[field] ?? field} Accepted on ${types.join(", ")}.`,
	};
}

const TRIGGER_FIELD_NAMES = [
	...new Set(Object.values(PUBLIC_TRIGGER_FIELDS).flat()),
];

// ── Insights (`src/routes/insights.ts`) ──

const INSIGHT_ID_PARAM = pp(
	"id",
	"Insight id (UUID), as returned by the insights list.",
);

const INSIGHT_NOT_FOUND = jsonError("No insight with this id");

const EXAMPLE_INSIGHT = {
	id: "9b0f6f1e-3c1a-4f55-8d64-0c2f7a5e1b30",
	rule: "receiver_down",
	severity: "losing",
	impact: 214,
	resource: { kind: "webhook", id: EXAMPLE_ID, name: "sbtc-moves" },
	line: "sbtc-moves has failed 12 deliveries in a row",
	meta: "since 16:06 UTC",
	lead: "Your receiver is down, not us.",
	body: "hooks.example.dev returns HTTP 502 on every delivery since 16:06 UTC. 214 deliveries queued to retry.",
	evidence: [
		{
			kind: "shapes",
			title: "What the receiver sent back",
			shapes: [{ code: "502", body: "Bad Gateway", count: 12, isNew: true }],
		},
	],
	handoff: {
		prompt:
			'My Secondlayer webhook "sbtc-moves" has been failing since 16:06 UTC. The receiver hooks.example.dev returns HTTP 502 on every delivery. Check the service behind hooks.example.dev. Then run sl webhooks doctor sbtc-moves.',
		commands: ["sl webhooks doctor sbtc-moves"],
	},
	how: {
		detector:
			"the newest 5 or more delivery attempts are 5xx or got no response",
		facts: [["consecutive failures", "12"]],
	},
	createdAt: "2026-10-15T16:07:00.000Z",
	resolvedAt: null,
};

const INSIGHT_SCHEMA = {
	type: "object",
	description:
		"One ranked finding about a webhook, subgraph or the account. Code detects it and computes every number; `handoff.prompt` is plain text for a coding agent and never contains code.",
	required: [
		"id",
		"rule",
		"severity",
		"impact",
		"resource",
		"line",
		"lead",
		"body",
		"evidence",
		"handoff",
		"how",
		"createdAt",
	],
	properties: {
		id: { type: "string", description: "Insight id (UUID)." },
		rule: {
			type: "string",
			description:
				"Detector that fired, such as `receiver_down` or `subgraph_lag`. One open insight per resource and rule.",
		},
		severity: {
			type: "string",
			enum: ["losing", "will_fail", "costs", "recovered"],
			description:
				"`losing` is dropping events now, `will_fail` is about to, `costs` is spending money for nothing, `recovered` was resolved in the last 24 hours.",
		},
		impact: {
			type: "number",
			description:
				"Events, rows or dollars affected. Breaks ties inside a severity.",
		},
		resource: {
			type: "object",
			description:
				"What the insight is about. A subgraph's `id` and `name` are both its name; account insights use `id` `account`.",
			required: ["kind", "id", "name"],
			properties: {
				kind: { type: "string", enum: ["webhook", "subgraph", "account"] },
				id: { type: "string" },
				name: { type: "string" },
			},
		},
		line: { type: "string", description: "The collapsed row, bold part." },
		meta: { type: "string", description: "The collapsed row, muted part." },
		lead: {
			type: "string",
			description: "First sentence of the expanded card.",
		},
		body: {
			type: "string",
			description: "One to three plain sentences after `lead`. No code.",
		},
		evidence: {
			type: "array",
			description:
				"One or two blocks to draw, each with a `kind` of `series`, `table`, `shapes` or `timeline`.",
			items: { type: "object", additionalProperties: true },
		},
		handoff: {
			type: "object",
			description:
				"A prompt for the developer's coding agent and the `sl` commands that act on our side.",
			required: ["prompt", "commands"],
			properties: {
				prompt: { type: "string" },
				commands: { type: "array", items: { type: "string" } },
			},
		},
		how: {
			type: "object",
			description:
				"How the detector decided: its rule in one sentence, the raw facts, and an optional model-labelled cause shown only at confidence 0.85 or higher.",
			required: ["detector", "facts"],
			properties: {
				detector: { type: "string" },
				facts: {
					type: "array",
					items: { type: "array", items: { type: "string" } },
				},
				label: {
					type: "object",
					properties: {
						cause: { type: "string" },
						confidence: { type: "number" },
					},
				},
			},
		},
		createdAt: {
			type: "string",
			format: "date-time",
			description: "When the incident first fired.",
		},
		resolvedAt: {
			type: ["string", "null"],
			format: "date-time",
			description: "When it cleared, for `recovered` insights.",
		},
	},
	example: EXAMPLE_INSIGHT,
};

const insightsPaths = {
	"/api/insights": {
		get: {
			tags: ["webhooks"],
			summary: "List insights",
			"x-nav-title": "List insights",
			description:
				"Ranked findings about this instance's webhooks and subgraphs: losing events first, then about to fail, then costing money, then recently recovered. Dismissed and expected insights are left out.",
			security: WRITE_SECURITY,
			parameters: [
				qp(
					"resource",
					"string",
					false,
					"Only one resource, as `<kind>:<id>`, such as `webhook:<id>` or `subgraph:<name>`.",
				),
			],
			responses: apiReadResponses({
				"200": json200(
					{
						type: "object",
						required: ["data"],
						properties: {
							data: {
								type: "array",
								items: INSIGHT_SCHEMA,
								description: "Insights in rank order.",
							},
						},
						example: { data: [EXAMPLE_INSIGHT] },
					},
					"Insights in rank order",
				),
				"400": jsonError(
					"`resource` is not `<kind>:<id>` (`VALIDATION_ERROR`)",
				),
			}),
		},
	},
	"/api/insights/{id}/dismiss": {
		post: {
			tags: ["webhooks"],
			summary: "Dismiss an insight",
			"x-nav-title": "Dismiss",
			description:
				"Hides this incident. If the same rule fires again after it clears, the new incident shows. Takes no body.",
			security: WRITE_SECURITY,
			parameters: [INSIGHT_ID_PARAM],
			responses: writeResponses({
				"200": json200(OK_SCHEMA, "Dismissed"),
				"404": INSIGHT_NOT_FOUND,
			}),
		},
		delete: {
			tags: ["webhooks"],
			summary: "Undo dismissing an insight",
			"x-nav-title": "Undismiss",
			description: "Shows a dismissed insight again.",
			security: WRITE_SECURITY,
			parameters: [INSIGHT_ID_PARAM],
			responses: writeResponses({
				"200": json200(OK_SCHEMA, "Shown again"),
				"404": INSIGHT_NOT_FOUND,
			}),
		},
	},
	"/api/insights/{id}/snooze": {
		post: {
			tags: ["webhooks"],
			summary: "Snooze an insight until a time",
			"x-nav-title": "Snooze",
			description:
				"Hides this insight until the time you give, at most 7 days ahead. It shows again then, or earlier if you remove the snooze.",
			security: WRITE_SECURITY,
			parameters: [INSIGHT_ID_PARAM],
			requestBody: jsonBody({
				type: "object",
				required: ["until"],
				properties: {
					until: {
						type: "string",
						format: "date-time",
						description: "When it shows again. Must be in the next 7 days.",
					},
				},
				example: { until: "2026-10-19T09:00:00.000Z" },
			}),
			responses: writeResponses({
				"200": json200(OK_SCHEMA, "Snoozed"),
				"400": jsonError(
					"`until` is not a time in the next 7 days (`VALIDATION_ERROR`)",
				),
				"404": INSIGHT_NOT_FOUND,
			}),
		},
		delete: {
			tags: ["webhooks"],
			summary: "Remove an insight's snooze",
			"x-nav-title": "Unsnooze",
			description: "Shows a snoozed insight again now.",
			security: WRITE_SECURITY,
			parameters: [INSIGHT_ID_PARAM],
			responses: writeResponses({
				"200": json200(OK_SCHEMA, "Shown again"),
				"404": INSIGHT_NOT_FOUND,
			}),
		},
	},
	"/api/insights/{id}/expected": {
		post: {
			tags: ["webhooks"],
			summary: "Mark an insight expected",
			"x-nav-title": "Mark expected",
			description:
				"Mutes this rule for this resource, including future incidents, until you remove the mute. Takes no body.",
			security: WRITE_SECURITY,
			parameters: [INSIGHT_ID_PARAM],
			responses: writeResponses({
				"200": json200(OK_SCHEMA, "Muted"),
				"404": INSIGHT_NOT_FOUND,
			}),
		},
		delete: {
			tags: ["webhooks"],
			summary: "Unmark an insight as expected",
			"x-nav-title": "Unmark expected",
			description:
				"Removes the mute for this rule and resource, so it shows again whenever it fires.",
			security: WRITE_SECURITY,
			parameters: [INSIGHT_ID_PARAM],
			responses: writeResponses({
				"200": json200(OK_SCHEMA, "Unmuted"),
				"404": INSIGHT_NOT_FOUND,
			}),
		},
	},
};

export const webhooksPaths = {
	"/api/webhooks": {
		get: {
			tags: ["webhooks"],
			summary: "List webhooks",
			"x-nav-title": "List webhooks",
			description:
				"Every webhook on this instance, newest first, with status and last delivery times. Paged by offset.",
			security: WRITE_SECURITY,
			parameters: [
				qp("_limit", "integer", false, "Page size, 1 to 200. Default 50."),
				qp("_offset", "integer", false, "Rows to skip. Default 0."),
			],
			responses: apiReadResponses({
				"200": json200(
					{
						type: "object",
						required: ["data"],
						properties: {
							data: {
								type: "array",
								items: { $ref: "#/components/schemas/WebhookSummary" },
								description: "One page of webhooks, newest first.",
							},
						},
						example: { data: [EXAMPLE_SUMMARY] },
					},
					"One page of webhooks",
				),
			}),
		},
		post: {
			tags: ["webhooks"],
			summary: "Create a webhook",
			"x-nav-title": "Create",
			description:
				"Takes `triggers` and starts at the chain tip, with no backfill. The response carries the signing secret. This is the only time it is returned, so store it now; `rotate-secret` issues a new one.",
			security: WRITE_SECURITY,
			requestBody: jsonBody({
				$ref: "#/components/schemas/CreateWebhookRequest",
			}),
			responses: writeResponsesWithout200({
				"201": json200(
					{ $ref: "#/components/schemas/WebhookWithSecret" },
					"Created. The body carries the signing secret, once",
				),
				"400": jsonError(`${ERROR_400}. ${SUBGRAPH_WEBHOOKS_REMOVED_NOTE}`),
				"409": jsonError("A webhook with that name already exists"),
				"500": jsonError("The webhook could not be stored (`INTERNAL_ERROR`)"),
			}),
		},
	},
	"/api/webhooks/{id}": {
		get: {
			tags: ["webhooks"],
			summary: "Get a webhook",
			"x-nav-title": "Get",
			description:
				"Full config and delivery health for one webhook. Never includes the signing secret.",
			security: WRITE_SECURITY,
			parameters: [ID_PARAM],
			responses: apiReadResponses({
				"200": json200({ $ref: "#/components/schemas/Webhook" }, "The webhook"),
				"404": NOT_FOUND,
			}),
		},
		patch: {
			tags: ["webhooks"],
			summary: "Update a webhook",
			"x-nav-title": "Update",
			description:
				"Change any subset of fields; at least one is required. `triggers` are fixed at create: to change them, create a new webhook.",
			security: WRITE_SECURITY,
			parameters: [ID_PARAM],
			requestBody: jsonBody({
				$ref: "#/components/schemas/UpdateWebhookRequest",
			}),
			responses: writeResponses({
				"200": json200(
					{ $ref: "#/components/schemas/Webhook" },
					"The updated webhook",
				),
				"400": jsonError(`${ERROR_400}. ${SUBGRAPH_WEBHOOKS_REMOVED_NOTE}`),
				"404": NOT_FOUND,
			}),
		},
		delete: {
			tags: ["webhooks"],
			summary: "Delete a webhook",
			"x-nav-title": "Delete",
			description:
				"Removes the webhook. Nothing more is delivered to its URL. Cannot be undone.",
			security: WRITE_SECURITY,
			parameters: [ID_PARAM],
			responses: writeResponses({
				"200": json200(OK_SCHEMA, "Deleted"),
				"404": NOT_FOUND,
			}),
		},
	},
	"/api/webhooks/{id}/pause": {
		post: {
			tags: ["webhooks"],
			summary: "Pause a webhook",
			"x-nav-title": "Pause",
			description:
				"Sets `status` to `paused`. Matched events keep queueing and deliver on resume. Takes no body.",
			security: WRITE_SECURITY,
			parameters: [ID_PARAM],
			responses: writeResponses({
				"200": json200(
					{ $ref: "#/components/schemas/Webhook" },
					"The paused webhook",
				),
				"404": NOT_FOUND,
			}),
		},
	},
	"/api/webhooks/{id}/resume": {
		post: {
			tags: ["webhooks"],
			summary: "Resume a webhook",
			"x-nav-title": "Resume",
			description:
				"Sets `status` to `active` and resets the circuit breaker (`circuitFailures`, `circuitOpenedAt`). Queued events start delivering. Takes no body.",
			security: WRITE_SECURITY,
			parameters: [ID_PARAM],
			responses: writeResponses({
				"200": json200(
					{ $ref: "#/components/schemas/Webhook" },
					"The resumed webhook",
				),
				"404": NOT_FOUND,
			}),
		},
	},
	"/api/webhooks/{id}/rotate-secret": {
		post: {
			tags: ["webhooks"],
			summary: "Rotate the signing secret",
			"x-nav-title": "Rotate secret",
			description:
				"Issues a new signing secret and returns it, once. Deliveries signed with the old secret stop verifying immediately, so update your receiver right away. Takes no body.",
			security: WRITE_SECURITY,
			parameters: [ID_PARAM],
			responses: writeResponses({
				"200": json200(
					{ $ref: "#/components/schemas/WebhookWithSecret" },
					"The webhook and its new signing secret",
				),
				"404": NOT_FOUND,
			}),
		},
	},
	"/api/webhooks/{id}/test": {
		post: {
			tags: ["webhooks"],
			summary: "Send a test delivery",
			"x-nav-title": "Send a test",
			description:
				"Posts one sample event, built and signed in the webhook's format, to its URL through the SSRF guard, and logs it under deliveries. The body has `data.test: true`, so receivers can tell it from a live event. Works while paused. Takes no body.",
			security: WRITE_SECURITY,
			parameters: [ID_PARAM],
			responses: writeResponses({
				"200": json200(
					{ $ref: "#/components/schemas/WebhookTestResult" },
					"What the target answered. A failed delivery still returns 200; check `ok`",
				),
				"404": NOT_FOUND,
			}),
		},
	},
	"/api/webhooks/{id}/deliveries": {
		get: {
			tags: ["webhooks"],
			summary: "List delivery attempts",
			"x-nav-title": "Delivery attempts",
			description:
				"The last 100 delivery attempts, newest first, including test deliveries. `total` counts every attempt ever logged for the webhook. With `from` and `to`, only attempts dispatched in that window; `total` counts the window.",
			security: WRITE_SECURITY,
			parameters: [
				ID_PARAM,
				qp(
					"from",
					"string",
					false,
					"Window start, inclusive, ISO 8601. Needs `to`; at most 31 days before it.",
				),
				qp(
					"to",
					"string",
					false,
					"Window end, exclusive, ISO 8601. Needs `from`.",
				),
			],
			responses: apiReadResponses({
				"200": json200(
					{
						type: "object",
						required: ["total", "data"],
						properties: {
							total: {
								type: "integer",
								description: "Every attempt ever logged for this webhook.",
							},
							data: {
								type: "array",
								items: { $ref: "#/components/schemas/WebhookDelivery" },
								description: "Up to 100 attempts, newest first.",
							},
						},
						example: {
							total: 4182,
							data: [
								{
									id: "9b2e41c7-5d0a-4f3e-8c61-2a7f90d4e3b5",
									seq: 4182,
									attempt: 1,
									statusCode: 200,
									blockHeight: 8700076,
									blockTime: "2026-09-22T14:02:58.000Z",
									errorMessage: null,
									durationMs: 142,
									responseBody: '{"received":true}',
									dispatchedAt: "2026-09-22T14:03:11.402Z",
								},
							],
						},
					},
					"Recent delivery attempts",
				),
				"404": NOT_FOUND,
			}),
		},
	},
	"/api/webhooks/{id}/dead": {
		get: {
			tags: ["webhooks"],
			summary: "List dead-lettered events",
			"x-nav-title": "Dead events",
			description:
				"Events that used up `maxRetries` without a 2xx, newest failure first, up to 100. Requeue one to try it again.",
			security: WRITE_SECURITY,
			parameters: [ID_PARAM],
			responses: apiReadResponses({
				"200": json200(
					{
						type: "object",
						required: ["data"],
						properties: {
							data: {
								type: "array",
								items: { $ref: "#/components/schemas/WebhookDeadEvent" },
								description: "Up to 100 dead events, newest failure first.",
							},
						},
						example: {
							data: [EXAMPLE_DEAD],
						},
					},
					"Dead-lettered events",
				),
				"404": NOT_FOUND,
			}),
		},
	},
	"/api/webhooks/{id}/dead/{outbox_id}/requeue": {
		post: {
			tags: ["webhooks"],
			summary: "Requeue a dead event",
			"x-nav-title": "Requeue",
			description:
				"Moves one dead event back to pending with its attempt count reset. It delivers at live priority, even if it came from a replay. Takes no body.",
			security: WRITE_SECURITY,
			parameters: [
				ID_PARAM,
				pp(
					"outbox_id",
					"Dead event id (UUID), the `id` from the dead-letter list.",
				),
			],
			responses: writeResponses({
				"200": json200(OK_SCHEMA, "Requeued"),
				"404": jsonError(
					"No webhook with this id, or no dead event with this id on it",
				),
			}),
		},
	},
	"/api/webhooks/{id}/replay": {
		post: {
			tags: ["webhooks"],
			summary: "Replay a block range",
			"x-nav-title": "Replay",
			description:
				"Queues historical events in a block range for redelivery, capped at 100,000 blocks. Replays are idempotent: the same range yields the same `replayId` and delivers nothing twice unless `force` is set. They drain through a 10% share of the outbox so live traffic keeps priority, and never move the live cursor. Replays deliver the normal `chain.<type>.apply` envelope.",
			security: WRITE_SECURITY,
			parameters: [ID_PARAM],
			requestBody: jsonBody({
				$ref: "#/components/schemas/ReplayWebhookRequest",
			}),
			responses: writeResponsesWithout200({
				"202": json200(
					{ $ref: "#/components/schemas/WebhookReplayResult" },
					"Replay queued",
				),
				"400": jsonError(
					`${ERROR_400}. Also: \`fromBlock\` after \`toBlock\`, or a range over 100,000 blocks`,
				),
				"404": NOT_FOUND,
				"500": jsonError("The replay could not be queued (`INTERNAL_ERROR`)"),
			}),
		},
	},
	...insightsPaths,
};

/** Resource schemas for these responses, merged into `components.schemas`. */
export const webhooksSchemas = {
	WebhookSummary: {
		type: "object",
		description: "A webhook as it appears in the list.",
		required: Object.keys(SUMMARY_PROPERTIES),
		properties: SUMMARY_PROPERTIES,
		example: EXAMPLE_SUMMARY,
	},
	Webhook: {
		type: "object",
		description:
			"A webhook's full config and delivery health. Never includes the signing secret.",
		required: Object.keys(DETAIL_PROPERTIES),
		properties: DETAIL_PROPERTIES,
		example: EXAMPLE_DETAIL,
	},
	WebhookWithSecret: {
		type: "object",
		description:
			"Returned by create and rotate-secret only. The one place the signing secret appears.",
		required: ["webhook", "signingSecret"],
		properties: {
			webhook: { $ref: "#/components/schemas/Webhook" },
			signingSecret: {
				type: "string",
				description:
					"Plaintext signing secret, 64 hex characters. Shown once; store it server-side to verify deliveries.",
			},
		},
		example: { webhook: EXAMPLE_DETAIL, signingSecret: FAKE_SECRET },
	},
	ChainTrigger: {
		type: "object",
		description:
			"One chain event to match. `type` picks the event; the other fields narrow it. Each type accepts only its own fields, and anything else is refused with a 400. Omitted fields match everything.",
		required: ["type"],
		properties: {
			type: {
				type: "string",
				enum: [...PUBLIC_TRIGGER_TYPES],
				description: "Event to match.",
			},
			...Object.fromEntries(
				TRIGGER_FIELD_NAMES.map((f) => [f, triggerFieldSchema(f)]),
			),
		},
		example: EXAMPLE_TRIGGERS[0],
	},
	CreateWebhookRequest: {
		type: "object",
		description: "Webhooks fire on chain events: send the `triggers` to match.",
		required: ["name", "url", "triggers"],
		properties: {
			name: {
				type: "string",
				minLength: 1,
				maxLength: 128,
				description: "Unique name on this instance.",
			},
			url: {
				type: "string",
				description:
					"Delivery target, `http://` or `https://`. Private addresses are refused at delivery time.",
			},
			triggers: {
				type: "array",
				minItems: 1,
				maxItems: 50,
				items: { $ref: "#/components/schemas/ChainTrigger" },
				description:
					"1 to 50 triggers. An event matching any of them is delivered.",
			},
			format: { ...FORMAT_PROP, default: "standard-webhooks" },
			...TUNING_PROPS,
		},
		example: {
			name: "sbtc-moves",
			url: "https://example.com/webhooks/sbtc",
			triggers: EXAMPLE_TRIGGERS,
		},
	},
	UpdateWebhookRequest: {
		type: "object",
		description:
			"Any subset of these fields, at least one. `triggers` cannot change.",
		minProperties: 1,
		properties: {
			name: {
				type: "string",
				minLength: 1,
				maxLength: 128,
				description: "New unique name.",
			},
			url: {
				type: "string",
				description: "New delivery target, `http://` or `https://`.",
			},
			format: FORMAT_PROP,
			...TUNING_PROPS,
		},
		example: { url: "https://example.com/webhooks/sbtc-v2", maxRetries: 10 },
	},
	ReplayWebhookRequest: {
		type: "object",
		description: "Block range to replay, inclusive.",
		required: ["fromBlock", "toBlock"],
		properties: {
			fromBlock: {
				type: "integer",
				minimum: 0,
				description: "First block, inclusive.",
			},
			toBlock: {
				type: "integer",
				minimum: 0,
				description:
					"Last block, inclusive. At most 100,000 blocks after `fromBlock`.",
			},
			force: {
				type: "string",
				minLength: 1,
				maxLength: 64,
				description:
					"Any string, up to 64 characters. Makes a new `replayId`, so an already-replayed range delivers again.",
			},
		},
		example: { fromBlock: 8650000, toBlock: 8700000 },
	},
	WebhookReplayResult: {
		type: "object",
		description: "What a replay queued.",
		required: ["replayId", "enqueuedCount", "scannedCount"],
		properties: {
			replayId: {
				type: "string",
				description:
					"16 hex characters, derived from webhook, range and `force`. The same inputs give the same id.",
			},
			enqueuedCount: {
				type: "integer",
				description:
					"Events queued. Lower than matches when part of the range was replayed before.",
			},
			scannedCount: {
				type: "integer",
				description: "Rows or events examined in the range.",
			},
		},
		example: {
			replayId: "a41f09c3d27e8b65",
			enqueuedCount: 312,
			scannedCount: 4870,
		},
	},
	WebhookTestResult: {
		type: "object",
		description: "Outcome of one test delivery.",
		required: ["ok", "statusCode", "error", "durationMs", "deliveryId"],
		properties: {
			ok: {
				type: "boolean",
				description: "`true` when the target answered 2xx.",
			},
			statusCode: {
				type: ["integer", "null"],
				description: "HTTP status. `null` when no response came back.",
			},
			error: {
				type: ["string", "null"],
				description: "Why the delivery failed. `null` on success.",
			},
			durationMs: {
				type: "integer",
				description: "Round trip in milliseconds.",
			},
			deliveryId: {
				type: "string",
				format: "uuid",
				description: "The logged attempt, as it appears under deliveries.",
			},
		},
		example: {
			ok: true,
			statusCode: 200,
			error: null,
			durationMs: 138,
			deliveryId: "c7a0e5d2-1f4b-4e8a-9d36-0b5f2a7c9e14",
		},
	},
	WebhookDelivery: {
		type: "object",
		description: "One HTTP attempt to deliver an event.",
		required: [
			"id",
			"seq",
			"attempt",
			"statusCode",
			"blockHeight",
			"blockTime",
			"errorMessage",
			"durationMs",
			"responseBody",
			"dispatchedAt",
		],
		properties: {
			id: { type: "string", format: "uuid", description: "Attempt id." },
			seq: {
				type: "integer",
				description:
					"Position in the webhook's lifetime log. The newest attempt equals `total`.",
			},
			attempt: {
				type: "integer",
				description: "Which try this was for its event, from 1.",
			},
			statusCode: {
				type: ["integer", "null"],
				description: "HTTP status. `null` when no response came back.",
			},
			blockHeight: {
				type: ["integer", "null"],
				description:
					"Block of the delivered event. `null` for test deliveries and for events already compacted out of the outbox.",
			},
			blockTime: {
				type: ["string", "null"],
				format: "date-time",
				description:
					"When the delivered event's block was produced. `null` for test deliveries, events already compacted out of the outbox, and rows written before this column existed.",
			},
			errorMessage: {
				type: ["string", "null"],
				description: "Why the attempt failed. `null` on success.",
			},
			durationMs: {
				type: ["integer", "null"],
				description: "Round trip in milliseconds.",
			},
			responseBody: {
				type: ["string", "null"],
				description: "Start of the target's response body.",
			},
			dispatchedAt: {
				type: "string",
				format: "date-time",
				description: "When the attempt was sent.",
			},
		},
		example: {
			id: "9b2e41c7-5d0a-4f3e-8c61-2a7f90d4e3b5",
			seq: 4182,
			attempt: 1,
			statusCode: 200,
			blockHeight: 8700076,
			blockTime: "2026-09-22T14:02:58.000Z",
			errorMessage: null,
			durationMs: 142,
			responseBody: '{"received":true}',
			dispatchedAt: "2026-09-22T14:03:11.402Z",
		},
	},
	WebhookDeadEvent: {
		type: "object",
		description: "An event that used up its retries without a 2xx.",
		required: [
			"id",
			"eventType",
			"attempt",
			"blockHeight",
			"txId",
			"payload",
			"failedAt",
			"createdAt",
		],
		properties: {
			id: {
				type: "string",
				format: "uuid",
				description: "Outbox id. Pass it as `outbox_id` to requeue.",
			},
			eventType: {
				type: "string",
				description: "Delivered `type`, e.g. `chain.ft_transfer.apply`.",
			},
			attempt: {
				type: "integer",
				description: "Attempts made before it was dead-lettered.",
			},
			blockHeight: {
				type: "integer",
				description: "Block the event came from.",
			},
			txId: {
				type: ["string", "null"],
				description: "Transaction behind the event, when there is one.",
			},
			payload: {
				type: "object",
				additionalProperties: true,
				description: "The event body that failed to deliver.",
			},
			failedAt: {
				type: ["string", "null"],
				format: "date-time",
				description: "When the last attempt failed.",
			},
			createdAt: {
				type: "string",
				format: "date-time",
				description: "When the event was queued.",
			},
		},
		example: EXAMPLE_DEAD,
	},
};
