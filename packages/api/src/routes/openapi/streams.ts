import {
	DECODED_EVENT_TYPES,
	VM_EVENT_TYPES,
} from "@secondlayer/stacks/filters";
import {
	STREAMS_ANON_RATE_LIMIT_PER_SECOND,
	STREAMS_DEFAULT_FROM_HEIGHT_WINDOW_BLOCKS,
	STREAMS_TIER_CONFIG,
	STREAMS_TIP_REORG_MARGIN_BLOCKS,
} from "../../streams/tiers.ts";
import { ERROR_401, READ_SECURITY, envelope, jsonError, qp } from "./shared.ts";

/**
 * Streams: the raw, ordered event firehose (`routes/streams.ts`,
 * `streams/*.ts`). Rows are `StreamsEventEnvelope` (`streams/events.ts`).
 */

const EVENT_TYPES = [...DECODED_EVENT_TYPES, ...VM_EVENT_TYPES];

const FREE_TIER = STREAMS_TIER_CONFIG.free;

const STREAMS_429 = `Rate limited on the hosted API (${STREAMS_ANON_RATE_LIMIT_PER_SECOND}/s per IP without a key, ${FREE_TIER.rateLimitPerSecond}/s on a free key). Self-hosted instances do not throttle Streams. Retry after \`Retry-After\` seconds`;

const STREAMS_403 = `A free-tier key asked for a height older than its ${FREE_TIER.retentionDays}-day retention window (\`AUTHORIZATION_ERROR\`). \`details\` carries \`oldest_seekable_height\`, \`oldest_cursor\` and \`dumps_manifest_url\` for the cold dumps. Keyless reads on a self-hosted instance have no retention limit`;

const STREAMS_503 =
	"No canonical block indexed yet (`CHAIN_DATA_UNAVAILABLE`). Wait for the indexer to ingest its first block";

/** Headers `respondSignedJson` adds when `STREAMS_SIGNING_PRIVATE_KEY` is set. */
const SIGNATURE_HEADERS = {
	"X-Signature": {
		description:
			"Base64 ed25519 signature over the exact response bytes. Sent only when the instance has a Streams signing key.",
		schema: { type: "string" },
	},
	"X-Signature-KeyId": {
		description:
			"Id of the key that signed the body. Verify with the public key from `GET /public/streams/signing-key`.",
		schema: { type: "string" },
	},
};

function signedJson200(
	description: string,
	schema: Record<string, unknown>,
	extraHeaders: Record<string, unknown> = {},
) {
	return {
		description,
		headers: { ...SIGNATURE_HEADERS, ...extraHeaders },
		content: { "application/json": { schema } },
	};
}

function limitParam(what: string) {
	return {
		name: "limit",
		in: "query",
		required: false,
		schema: { type: "integer", minimum: 1, maximum: 1000, default: 100 },
		description: `${what} Default 100. Values above 1000 are clamped to 1000.`,
	};
}

function eventTypesParam(name: string, description: string) {
	return {
		name,
		in: "query",
		required: false,
		style: "form",
		explode: false,
		schema: {
			type: "array",
			items: { type: "string", enum: EVENT_TYPES },
		},
		description,
	};
}

/** Start position and filters, shared by the page read and the SSE tail
 *  (both parse the same `STREAMS_EVENTS_ALLOWED` set). */
const START_PARAMS = [
	{
		...qp(
			"cursor",
			"string",
			false,
			"`<block_height>:<event_index>` from a previous page's `next_cursor`. Resumes strictly after it. Mutually exclusive with `from_cursor` and `from_height`.",
		),
		schema: { type: "string", example: "9048876:3" },
	},
	{
		...qp(
			"from_cursor",
			"string",
			false,
			"Same as `cursor`. `0:0` starts at genesis, subject to the key's retention window.",
		),
		schema: { type: "string", example: "0:0" },
	},
	qp(
		"from_height",
		"integer",
		false,
		`First block height to read. Mutually exclusive with a cursor. With neither, the read starts ${STREAMS_DEFAULT_FROM_HEIGHT_WINDOW_BLOCKS} blocks behind the tip.`,
	),
];

const FILTER_PARAMS = [
	qp(
		"to_height",
		"integer",
		false,
		`Last block height to read, inclusive. Always clamped to the tip minus a ${STREAMS_TIP_REORG_MARGIN_BLOCKS}-block reorg margin, which is also the default.`,
	),
	eventTypesParam(
		"types",
		"Comma-separated event types to include. Default: every classic type. With `clock=vm`, only vm types (`nested_contract_call`, `var_set`, `map_set`, `map_insert`, `map_delete`) are accepted; without it, only classic types.",
	),
	{
		...qp(
			"event_type",
			"string",
			false,
			"One event type, as an alias for `types`. Mutually exclusive with `types`; a set must use `types`.",
		),
		schema: { type: "string", enum: EVENT_TYPES },
	},
	eventTypesParam(
		"not_types",
		"Comma-separated event types to exclude, applied after `types`.",
	),
	{
		...qp(
			"contract_id",
			"string",
			false,
			"Contract principal, or a comma-separated set. Matches print events by the emitting contract and ft/nft events by the asset's contract. Other event types never match.",
		),
		schema: {
			type: "string",
			example:
				"SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.age000-governance-token",
		},
	},
	qp(
		"sender",
		"string",
		false,
		"Principal, or a comma-separated set, matched against the payload's `sender`. Event types without a sender never match. Classic clock only.",
	),
	qp(
		"recipient",
		"string",
		false,
		"Principal, or a comma-separated set, matched against the payload's `recipient`. Classic clock only.",
	),
	{
		...qp(
			"asset_identifier",
			"string",
			false,
			"Exact `<contract>::<asset>` match on the payload. Classic clock only.",
		),
		schema: {
			type: "string",
			example:
				"SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.age000-governance-token::alex",
		},
	},
	{
		...qp(
			"filters",
			"string",
			false,
			'JSON object of up to 8 labelled filter groups: `{ "<label>": { types?, contractId?, sender?, recipient?, assetIdentifier? } }`. Each value is a string or array of strings. Groups OR together, fields inside a group AND, and the flat filters above still apply to the whole scan. Each event lists the labels it matched in `matched`. Labels are letters, digits, `-` and `_`, 32 characters at most. Classic clock only.',
		),
		schema: {
			type: "string",
			example:
				'{"alex":{"types":["ft_transfer"],"contractId":"SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.age000-governance-token"},"stx":{"types":"stx_transfer"}}',
		},
	},
	{
		...qp(
			"clock",
			"string",
			false,
			"`classic` (default) reads Streams 1.0, where the cursor's second part is the event's position in the block. `vm` reads the node's opt-in vm events, where it is the vm ordinal: a separate cursor space, with rows only from the height the node started emitting them. With `vm`, `sender`, `recipient`, `asset_identifier` and `filters` are refused.",
		),
		schema: { type: "string", enum: ["classic", "vm"], default: "classic" },
	},
];

const REAL_EVENT = {
	cursor: "9048876:3",
	block_height: 9048876,
	block_hash:
		"0xba0676b375e8d5fc1495a02847cc3cc32b5f7c2113a5e73999d94ee8d75ebde4",
	burn_block_height: 968284,
	tx_id: "0xb9edea3443a9adb603d856bfed2d1e630146bed128b07aaaa259dc97e3eae2ba",
	tx_index: 2,
	event_index: 3,
	event_type: "ft_transfer",
	contract_id:
		"SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.age000-governance-token",
	payload: {
		amount: "416515709472",
		sender: "SP3R4NKXMGW6YXA44X2ESZPKJNV25X4ZN7DPW0RXR",
		recipient: "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.alex-vault",
		asset_identifier:
			"SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.age000-governance-token::alex",
	},
	ts: "2026-09-23T14:56:36.000Z",
	canonical: true,
	finalized: false,
};

const REAL_REORG = {
	id: "3f16c2c5-9551-4ae9-adb0-923668e5c65e",
	detected_at: "2026-09-15T15:39:38.129468Z",
	fork_point_height: 8996511,
	old_index_block_hash:
		"0x45ba0195071488eda13afa66d8ce8612558a739f781be5a032d96332797c4174",
	new_index_block_hash:
		"0xa686ff58e7c5ccb26c850a7eaffa7e7274fcbc081c706344eb6f1e1446023df0",
	orphaned_range: { from: "8996511:0", to: "8996512:2701" },
	new_canonical_tip: "8996511:0",
};

const REAL_TIP = {
	block_height: 9048928,
	block_hash:
		"0xe79ae38b78b37ad1f5d16c7afd04b4e202efe8d983d981803b785ca64257933f",
	burn_block_height: 968284,
	finalized_height: 9048671,
	lag_seconds: 4,
};

export const streamsPaths = {
	"/v1/streams": {
		get: {
			tags: ["streams"],
			summary: "Streams discovery",
			description:
				"Lists the Streams routes, the event types and filters `/v1/streams/events` accepts, and the cursor format. Served ahead of Streams auth, so it never needs a credential.",
			security: READ_SECURITY,
			responses: {
				"200": {
					description: "Route and filter catalog",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/StreamsDiscovery" },
						},
					},
				},
			},
		},
	},
	"/v1/streams/events": {
		get: {
			tags: ["streams"],
			summary: "Raw event firehose",
			description: `Canonical chain events in chain order: block height, then transaction position, then event position. Pages are capped at the tip minus a ${STREAMS_TIP_REORG_MARGIN_BLOCKS}-block reorg margin. With no cursor or \`from_height\`, the read starts ${STREAMS_DEFAULT_FROM_HEIGHT_WINDOW_BLOCKS} blocks behind the tip. An empty filtered page still returns a \`next_cursor\` past \`to_height\`, so a consumer never stalls. Pages at or below \`tip.finalized_height\` are immutable: they carry an \`ETag\` and answer \`If-None-Match\` with 304.`,
			security: READ_SECURITY,
			parameters: [
				limitParam("Events per page."),
				...START_PARAMS,
				...FILTER_PARAMS,
			],
			responses: (() => {
				const base = envelope("events", {
					$ref: "#/components/schemas/StreamsEvent",
				});
				return {
					...base,
					"200": {
						...base["200"],
						description:
							"A page of events, the cursor to resume from, the tip it was read against, and any reorgs that touched it",
						headers: {
							...SIGNATURE_HEADERS,
							ETag: {
								description:
									"Sent on finalized pages only. Covers events, `next_cursor` and `reorgs`, not the moving tip.",
								schema: { type: "string" },
							},
						},
					},
					"304": {
						description:
							"Finalized page unchanged since the `ETag` sent in `If-None-Match`",
					},
					"403": jsonError(STREAMS_403),
					"429": jsonError(STREAMS_429),
					"503": jsonError(STREAMS_503),
				};
			})(),
		},
	},
	"/v1/streams/events/stream": {
		get: {
			tags: ["streams"],
			summary: "Tail the event firehose over SSE",
			description:
				'Server-sent events over the same read as `/v1/streams/events`, with the same parameters. The server polls every 1.5 seconds by default (`STREAMS_SSE_POLL_MS`) and writes one frame per event: `id` is the event\'s cursor and `data` is `{ "event": <StreamsEvent> }`, or `{ "event", "sig", "key_id" }` with an ed25519 signature over the event\'s JSON when the instance has a signing key. After 20 seconds with no events it writes `event: ping` with empty data; ignore it. With no `cursor`, `from_cursor` or `from_height`, the tail starts at the current tip minus the reorg margin. `Last-Event-ID` is not read; to resume after a disconnect, reconnect with `from_cursor` set to the last `id` you processed.',
			security: READ_SECURITY,
			parameters: [
				limitParam("Most events written per poll."),
				...START_PARAMS,
				...FILTER_PARAMS,
			],
			responses: {
				"200": {
					description:
						'An open `text/event-stream`. Frames: `id: <cursor>` plus `data: {"event":{...}}` per event, and `event: ping` after 20 seconds idle',
					content: {
						"text/event-stream": {
							schema: {
								type: "string",
								example: `id: 9048876:3\ndata: ${JSON.stringify({ event: REAL_EVENT })}\n\nevent: ping\ndata: \n\n`,
							},
						},
					},
				},
				"400": jsonError(
					"An unknown query parameter. Other bad values close the stream without a frame",
				),
				"401": jsonError(ERROR_401),
				"429": jsonError(STREAMS_429),
			},
		},
	},
	"/v1/streams/reorgs": {
		get: {
			tags: ["streams"],
			summary: "Chain reorg history",
			description:
				"Reorgs the indexer recorded, oldest first. Page forward by passing `next_since` back as `since`.",
			security: READ_SECURITY,
			parameters: [
				{
					...qp(
						"since",
						"string",
						true,
						"Where to start. An ISO timestamp returns reorgs detected after it. A `<block_height>:<event_index>` cursor returns reorgs whose orphaned range ends at or after it. A `next_since` value (`<detected_at>~<id>`) resumes after the last reorg delivered.",
					),
					schema: { type: "string", example: "2026-09-01T00:00:00Z" },
				},
				limitParam("Reorgs per page."),
			],
			responses: {
				"200": signedJson200("Reorgs, oldest first", {
					type: "object",
					required: ["reorgs", "next_since"],
					properties: {
						reorgs: {
							type: "array",
							description: "Reorgs in detection order.",
							items: {
								$ref: "#/components/schemas/Reorg",
								example: REAL_REORG,
							},
						},
						next_since: {
							type: ["string", "null"],
							description:
								"`<detected_at>~<id>` of the last reorg. Pass it as `since` to continue. `null` when the page is empty.",
						},
					},
					example: {
						reorgs: [REAL_REORG],
						next_since:
							"2026-09-15T15:39:38.129468Z~3f16c2c5-9551-4ae9-adb0-923668e5c65e",
					},
				}),
				"400": jsonError(
					"`since` is missing or is not a timestamp, cursor or `next_since` value, or `limit` is not a positive integer",
				),
				"401": jsonError(ERROR_401),
				"429": jsonError(STREAMS_429),
			},
		},
	},
	"/v1/streams/canonical/{height}": {
		get: {
			tags: ["streams"],
			summary: "Canonical block by height",
			description:
				"The canonical Stacks block at one height and the Bitcoin block it anchors to. Finalized heights are cached for good and answer `If-None-Match` with 304; the `ETag` is the block hash.",
			security: READ_SECURITY,
			parameters: [
				{
					name: "height",
					in: "path",
					required: true,
					schema: { type: "integer", minimum: 0, example: 9048876 },
					description: "Stacks block height.",
				},
			],
			responses: {
				"200": signedJson200(
					"The canonical block",
					{ $ref: "#/components/schemas/StreamsCanonicalBlock" },
					{
						ETag: {
							description: "The block hash, quoted.",
							schema: { type: "string" },
						},
					},
				),
				"304": {
					description:
						"Block unchanged since the `ETag` sent in `If-None-Match`",
				},
				"400": jsonError("`height` is not a non-negative integer"),
				"401": jsonError(ERROR_401),
				"404": jsonError("No canonical block at that height yet"),
				"429": jsonError(STREAMS_429),
			},
		},
	},
	"/v1/streams/tip": {
		get: {
			tags: ["streams"],
			summary: "Current chain tip",
			description:
				"The newest canonical block this instance has indexed, the finality boundary, and how far back this caller can seek. Never cached.",
			security: READ_SECURITY,
			responses: {
				"200": signedJson200("The tip", {
					$ref: "#/components/schemas/StreamsTip",
				}),
				"401": jsonError(ERROR_401),
				"429": jsonError(STREAMS_429),
				"503": jsonError(STREAMS_503),
			},
		},
	},
};

/** Resource schemas for these responses, merged into `components.schemas`. */
export const streamsSchemas = {
	StreamsEvent: {
		type: "object",
		description:
			"One raw chain event. `payload` is the node's event body; its fields depend on `event_type`.",
		required: [
			"cursor",
			"block_height",
			"block_hash",
			"burn_block_height",
			"tx_id",
			"tx_index",
			"event_index",
			"event_type",
			"contract_id",
			"payload",
			"ts",
			"finalized",
		],
		properties: {
			cursor: {
				type: "string",
				description:
					"`<block_height>:<event_index>`. Pass as `cursor` or `from_cursor`.",
			},
			block_height: {
				type: "integer",
				description: "Stacks block the event landed in.",
			},
			block_hash: { type: "string", description: "That block's hash." },
			burn_block_height: {
				type: "integer",
				description: "Bitcoin block that block anchors to.",
			},
			tx_id: {
				type: "string",
				description: "Transaction that emitted the event.",
			},
			tx_index: {
				type: "integer",
				description: "Its position in the block.",
			},
			event_index: {
				type: "integer",
				description:
					"The event's position among the block's Streams events, from 0. On `clock=vm`, the vm ordinal.",
			},
			event_type: {
				type: "string",
				enum: EVENT_TYPES,
				description:
					"Classic types on the default clock, vm types on `clock=vm`. A page never mixes them.",
			},
			contract_id: {
				type: ["string", "null"],
				description:
					"Emitting contract for `print`, asset contract for ft/nft events, `null` otherwise.",
			},
			payload: {
				type: "object",
				additionalProperties: true,
				description:
					"The event body. Prints carry `topic`, `value` and `contract_id`; transfers carry `sender`, `recipient`, `amount` or `value`, and `asset_identifier`.",
			},
			ts: {
				type: "string",
				format: "date-time",
				description: "The block's timestamp.",
			},
			canonical: {
				type: "boolean",
				description:
					"Always `true`: the firehose serves the canonical chain only.",
			},
			matched: {
				type: "array",
				items: { type: "string" },
				description:
					"Labels from `filters` this event satisfied. Present only when the request used `filters`.",
			},
			finalized: {
				type: "boolean",
				description:
					"`true` when the block is at or below `tip.finalized_height` and can no longer reorg.",
			},
		},
		example: REAL_EVENT,
	},
	StreamsTip: {
		type: "object",
		description:
			"The newest canonical block and how far back this caller can read.",
		required: [
			"block_height",
			"block_hash",
			"burn_block_height",
			"finalized_height",
			"lag_seconds",
			"oldest_seekable_height",
			"oldest_cursor",
		],
		properties: {
			block_height: {
				type: "integer",
				description:
					"Highest canonical Stacks block this instance has indexed.",
			},
			block_hash: { type: "string", description: "That block's hash." },
			burn_block_height: {
				type: "integer",
				description: "The Bitcoin block it anchors to.",
			},
			finalized_height: {
				type: "integer",
				description:
					"Highest Stacks block whose Bitcoin anchor has 6 confirmations. Rows at or below it are immutable.",
			},
			lag_seconds: {
				type: "integer",
				description: "Seconds since the tip block was produced.",
			},
			oldest_seekable_height: {
				type: ["integer", "null"],
				description: `Oldest height this caller's key can read (${FREE_TIER.retentionDays} day back on a free key). \`null\` when there is no limit, including every keyless read.`,
			},
			oldest_cursor: {
				type: ["string", "null"],
				description:
					"`<oldest_seekable_height>:0`, ready to pass as `from_cursor`. `null` with no limit.",
			},
		},
		example: {
			...REAL_TIP,
			oldest_seekable_height: null,
			oldest_cursor: null,
		},
	},
	StreamsCanonicalBlock: {
		type: "object",
		description: "The canonical Stacks block at a height.",
		required: [
			"block_height",
			"block_hash",
			"burn_block_height",
			"burn_block_hash",
			"is_canonical",
		],
		properties: {
			block_height: { type: "integer", description: "Stacks block height." },
			block_hash: { type: "string", description: "Stacks block hash." },
			burn_block_height: {
				type: "integer",
				description: "Bitcoin block it anchors to.",
			},
			burn_block_hash: {
				type: ["string", "null"],
				description: "That Bitcoin block's hash.",
			},
			is_canonical: {
				type: "boolean",
				const: true,
				description: "Always `true`.",
			},
		},
		example: {
			block_height: 9048876,
			block_hash:
				"0xba0676b375e8d5fc1495a02847cc3cc32b5f7c2113a5e73999d94ee8d75ebde4",
			burn_block_height: 968284,
			burn_block_hash:
				"0x00000000000000000001b1cadea50180db28922325872c9f16ca19edda3f8bae",
			is_canonical: true,
		},
	},
	StreamsDiscovery: {
		type: "object",
		description: "Catalog of the Streams routes and filters.",
		properties: {
			routes: {
				type: "array",
				description:
					"Each route with its method, a one-line description, and for the event feed its event types and filters.",
				items: {
					type: "object",
					properties: {
						path: { type: "string" },
						method: { type: "string" },
						description: { type: "string" },
						event_types: { type: "array", items: { type: "string" } },
						filters: { type: "array", items: {} },
						auth: { type: "string" },
					},
				},
			},
			cursor: {
				type: "object",
				description: "Cursor `format` and resume `semantics`.",
				properties: {
					format: { type: "string" },
					semantics: { type: "string" },
				},
			},
			reorgs_shape: {
				type: "object",
				description: "Field names and types of a reorg record.",
				additionalProperties: { type: "string" },
			},
		},
		example: {
			routes: [
				{
					path: "/v1/streams/events",
					method: "GET",
					description:
						"Raw event firehose. Cursor-paginated. Returns events[], next_cursor, tip, reorgs[].",
					event_types: [...DECODED_EVENT_TYPES],
					filters: [
						{
							name: "types",
							type: "event_type[]",
							description: "Event types to include",
						},
						{ name: "contract_id", type: "principal | comma-list" },
						{ name: "limit", type: "number (max 1000)" },
					],
					auth: "bearer required, metered per row",
				},
				{
					path: "/v1/streams/tip",
					method: "GET",
					description:
						"Current chain tip: { block_height, block_hash, burn_block_height, finalized_height, lag_seconds }.",
				},
			],
			cursor: {
				format: "<block_height>:<event_index>",
				semantics:
					"opaque resume token; pass back unchanged to continue. Equals last event's cursor (inclusive on output, exclusive on input).",
			},
			reorgs_shape: {
				detected_at: "ISO 8601",
				new_canonical_tip: "<block_height>:<event_index>",
				new_canonical_height: "number",
				new_canonical_event_index: "number",
			},
		},
	},
};
