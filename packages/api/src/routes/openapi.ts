import type { InstanceMode } from "@secondlayer/shared/mode";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { Hono } from "hono";
import {
	HOSTED_OPENAPI_PATHS,
	WORKLOAD_OPENAPI_PREFIXES,
} from "../route-manifest.ts";
import { MAX_LIMIT } from "./subgraph-query-helpers.ts";

/** `contract_id` on the two consume-able feeds accepts a comma-separated set,
 *  so one cursor can follow a whole protocol. */
const CONTRACT_ID_PARAM = qp(
	"contract_id",
	"string",
	false,
	"Contract principal, or a comma-separated set of up to 20 (e.g. `SP1.sbtc-token,SP1.sbtc-registry`). Mutually exclusive with `trait`.",
);

/**
 * Auth, as the shipped code enforces it (`src/auth/read-plane.ts`,
 * `src/middleware/auth-modes.ts`, `src/middleware/csrf.ts`).
 *
 * `/v1` reads: `security: [{}, { bearerAuth: [] }]` — anonymous OR bearer.
 * OpenAPI has no way to say "required depending on how the operator bound the
 * socket", and that is exactly the shipped rule: keyless while the API is
 * reachable only over loopback, instance token required once it is published
 * past loopback. Declaring the bearer *required* would describe a 401 that
 * never happens on the default self-host bind; declaring no `security` at all
 * would hide that a token is ever needed. Optional-bearer is the only one of
 * the three that generates a client with an optional token, which is the real
 * surface. The prose says which half of the rule applies when.
 */
const READ_SECURITY = [{}, { bearerAuth: [] }];

/** `/api` writes: the instance token is required whenever one is set, and an
 *  instance reachable past loopback refuses to boot without one. */
const WRITE_SECURITY = [{ bearerAuth: [] }];

const AUTH_DESCRIPTION =
	"Auth is one credential: the instance token minted by `secondlayer init` (`INSTANCE_TOKEN`; `SL_API_KEY`/`API_KEY` are legacy aliases), sent as `Authorization: Bearer $INSTANCE_TOKEN`. `/v1` reads need no credential while the API is reachable only over loopback and require the token on every request once it is published past loopback — one rule, identical on Index, Streams, and Subgraphs, which is why every read below lists bearer auth as optional. Writes under `/api` require the token whenever one is set, and must send `Content-Type: application/json` (anything else is refused with 415 `UNSUPPORTED_MEDIA_TYPE`).";

/** The public API description. Exported so the docs site can render it as the
 *  API reference instead of restating it by hand — `bun run openapi` in
 *  apps/web writes it to src/generated/openapi.json. */
export const OPENAPI_SPEC = {
	openapi: "3.1.0",
	info: {
		title: "Secondlayer Public API",
		version: "1.0.0",
		description: `Public surfaces: Index (decoded chain events — stx/ft/nft transfers, mints, burns, prints, stacking), Streams (raw firehose, chain tip, reorg history), Subgraphs (reads over the schemas this instance has deployed; \`{ rows, next_cursor, tip }\` envelope with an \`_id\` keyset cursor, or a composite keyset cursor when \`_sort\` is used), and the workload plane under \`/api\` that deploys and drives them. Cursor format is \`<block_height>:<event_index>\` on Index/Streams; opaque on Subgraphs. ${AUTH_DESCRIPTION}`,
	},
	servers: [{ url: "http://127.0.0.1:3800", description: "Local instance" }],
	tags: [
		{
			name: "index",
			description:
				"Decoded chain events (transfers, mints/burns, prints, stacking)",
		},
		{
			name: "streams",
			description: "Raw event firehose, chain tip, and reorg history",
		},
		{
			name: "subgraphs",
			description:
				"Reads over deployed subgraphs — rows, counts, aggregates, generated schema and docs",
		},
		{
			name: "deployments",
			description:
				"Deploy, reindex, backfill, stop, and delete subgraphs on this instance (write plane, `/api`)",
		},
		{
			name: "subscriptions",
			description:
				"Webhook subscriptions: create, update, pause, replay, and inspect deliveries (write plane, `/api`)",
		},
		{
			name: "node",
			description: "Proxy to the Stacks node this instance follows",
		},
	],
	components: {
		securitySchemes: {
			bearerAuth: {
				type: "http",
				scheme: "bearer",
				bearerFormat: "hex",
				description:
					"The instance token from `secondlayer init` — 32 random bytes, hex-encoded, read from `INSTANCE_TOKEN` (`SL_API_KEY`/`API_KEY` are legacy aliases). There is no signup and no second key type: one instance, one token. Optional on `/v1` reads served over a loopback bind, required on every request once the instance is reachable past loopback, and required on every `/api` write whenever a token is set.",
			},
		},
		schemas: {
			Tip: {
				type: "object",
				properties: {
					block_height: { type: "integer" },
					block_hash: { type: "string" },
					burn_block_height: { type: "integer" },
					lag_seconds: { type: "integer" },
				},
			},
			Reorg: {
				type: "object",
				properties: {
					detected_at: { type: "string", format: "date-time" },
					new_canonical_tip: { type: "string", example: "7960000:42" },
					new_canonical_height: { type: "integer" },
					new_canonical_event_index: { type: "integer" },
				},
			},
			CursorEnvelope: {
				type: "object",
				properties: {
					events: { type: "array", items: { type: "object" } },
					next_cursor: { type: ["string", "null"], example: "7960000:42" },
					tip: { $ref: "#/components/schemas/Tip" },
					reorgs: {
						type: "array",
						items: { $ref: "#/components/schemas/Reorg" },
					},
				},
			},
			RowsEnvelope: {
				type: "object",
				properties: {
					rows: { type: "array", items: { type: "object" } },
					next_cursor: { type: ["string", "null"], example: "1042" },
					tip: {
						type: "object",
						properties: {
							block_height: { type: "integer" },
							subgraph_height: { type: "integer" },
							blocks_behind: { type: "integer" },
						},
					},
				},
			},
			Error: {
				type: "object",
				properties: {
					error: { type: "string" },
					code: { type: "string" },
				},
			},
		},
		parameters: {
			Limit: {
				name: "limit",
				in: "query",
				schema: { type: "integer", minimum: 1, maximum: 1000 },
				description: "Page size; capped at 1000.",
			},
			Cursor: {
				name: "cursor",
				in: "query",
				schema: { type: "string", example: "7960000:42" },
			},
		},
	},
	paths: {
		"/v1": {
			get: {
				summary: "Surface discovery",
				security: READ_SECURITY,
				responses: ok(),
			},
		},
		"/v1/batch": {
			post: {
				summary: "Batch public reads",
				description:
					"Up to 10 `/v1` reads in one round trip. Body: `{ requests: [{ path, params? }] }`. Each item keeps its own auth semantics; a forwarded credential applies to every item; results return in order with per-item status. Read-only, so the `/api` JSON content-type guard does not apply.",
				security: READ_SECURITY,
				responses: ok(),
			},
		},
		"/v1/openapi.json": {
			get: {
				summary: "This document",
				security: READ_SECURITY,
				responses: ok(),
			},
		},
		"/v1/subgraphs": {
			get: {
				tags: ["subgraphs"],
				summary: "List the subgraphs this instance serves",
				security: READ_SECURITY,
				responses: ok(),
			},
		},
		"/v1/subgraphs/{name}": {
			get: {
				tags: ["subgraphs"],
				summary: "Subgraph metadata: tables, columns, sync tip, doc links",
				security: READ_SECURITY,
				parameters: [pp("name")],
				responses: ok(),
			},
		},
		"/v1/subgraphs/{name}/openapi.json": {
			get: {
				tags: ["subgraphs"],
				summary: "Generated OpenAPI spec for one subgraph",
				security: READ_SECURITY,
				parameters: [pp("name")],
				responses: ok(),
			},
		},
		"/v1/subgraphs/{name}/schema.json": {
			get: {
				tags: ["subgraphs"],
				summary: "Generated agent schema for one subgraph",
				security: READ_SECURITY,
				parameters: [pp("name")],
				responses: ok(),
			},
		},
		"/v1/subgraphs/{name}/docs.md": {
			get: {
				tags: ["subgraphs"],
				summary: "Generated markdown docs for one subgraph",
				security: READ_SECURITY,
				parameters: [pp("name")],
				responses: ok(),
			},
		},
		"/v1/subgraphs/{name}/{table}": {
			get: {
				tags: ["subgraphs"],
				summary:
					"Rows, cursor-paginated by _id, or by _sort/_order ({ rows, next_cursor, tip }). Column filters via col.op=value, _limit, _fields.",
				security: READ_SECURITY,
				parameters: [
					pp("name"),
					pp("table"),
					qp(
						"_limit",
						"integer",
						false,
						`Page size, 1–${MAX_LIMIT}. Non-integers, 0, negatives, and values above ${MAX_LIMIT} are rejected (400), not clamped.`,
					),
					qp(
						"cursor",
						"string",
						false,
						"Opaque; pass back the previous page's next_cursor verbatim. Its shape depends on whether _sort was used to fetch that page — do not hand-construct one, and don't replay a cursor from one _sort/_order under a different _sort/_order (400).",
					),
					qp(
						"_sort",
						"string",
						false,
						"Single column to sort by (no comma list — composite keyset pagination pairs it with the _id tiebreaker, which only works for one column). jsonb columns are rejected (no meaningful ordering). Omit to keep the default _id-only ordering.",
					),
					qp(
						"_order",
						"string",
						false,
						'"asc" or "desc" — direction of the _id scan, or of the _sort column when _sort is present (any other value is rejected).',
					),
					qp("_fields", "string"),
				],
				responses: rowsEnvelope(),
			},
		},
		"/v1/subgraphs/{name}/{table}/count": {
			get: {
				tags: ["subgraphs"],
				summary: "Count rows matching filters",
				security: READ_SECURITY,
				parameters: [pp("name"), pp("table")],
				responses: ok(),
			},
		},
		"/v1/subgraphs/{name}/{table}/aggregate": {
			get: {
				tags: ["subgraphs"],
				summary:
					"Scalar aggregates (_count/_countDistinct/_sum/_min/_max) over filtered rows",
				security: READ_SECURITY,
				parameters: [pp("name"), pp("table")],
				responses: ok(),
			},
		},
		"/v1/subgraphs/{name}/{table}/stream": {
			get: {
				tags: ["subgraphs"],
				summary: "SSE tail of new rows (?since=<block> to replay)",
				security: READ_SECURITY,
				parameters: [pp("name"), pp("table")],
				responses: ok(),
			},
		},
		"/v1/index": {
			get: {
				tags: ["index"],
				summary: "Index discovery",
				security: READ_SECURITY,
				responses: ok(),
			},
		},
		"/v1/index/events": {
			get: {
				tags: ["index"],
				summary: "Decoded events by event_type",
				security: READ_SECURITY,
				parameters: [
					{
						name: "event_type",
						in: "query",
						required: true,
						schema: {
							type: "string",
							enum: [
								"ft_transfer",
								"nft_transfer",
								"stx_transfer",
								"stx_mint",
								"stx_burn",
								"stx_lock",
								"ft_mint",
								"ft_burn",
								"nft_mint",
								"nft_burn",
								"print",
							],
						},
					},
					{ $ref: "#/components/parameters/Limit" },
					{ $ref: "#/components/parameters/Cursor" },
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					CONTRACT_ID_PARAM,
					qp("asset_identifier", "string"),
					qp("sender", "string"),
					qp("recipient", "string"),
				],
				responses: envelope(),
			},
		},
		"/v1/index/ft-transfers": {
			get: {
				tags: ["index"],
				summary: "Fungible token transfers",
				security: READ_SECURITY,
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{ $ref: "#/components/parameters/Cursor" },
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					qp("contract_id", "string"),
					qp("sender", "string"),
					qp("recipient", "string"),
				],
				responses: envelope(),
			},
		},
		"/v1/index/nft-transfers": {
			get: {
				tags: ["index"],
				summary: "NFT transfers",
				security: READ_SECURITY,
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{ $ref: "#/components/parameters/Cursor" },
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					qp("contract_id", "string"),
					qp("asset_identifier", "string"),
					qp("sender", "string"),
					qp("recipient", "string"),
				],
				responses: envelope(),
			},
		},
		"/v1/index/contract-calls": {
			get: {
				tags: ["index"],
				summary: "Decoded contract-call transactions",
				security: READ_SECURITY,
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{
						name: "cursor",
						in: "query",
						schema: { type: "string", example: "7960000:3" },
					},
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					CONTRACT_ID_PARAM,
					qp("function_name", "string"),
					qp("sender", "string"),
				],
				responses: envelope("contract_calls"),
			},
		},
		"/v1/index/canonical": {
			get: {
				tags: ["index"],
				summary: "Canonical block-hash map",
				security: READ_SECURITY,
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{ $ref: "#/components/parameters/Cursor" },
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
				],
				responses: envelope("canonical"),
			},
		},
		"/v1/index/blocks": {
			get: {
				tags: ["index"],
				summary: "Canonical blocks",
				security: READ_SECURITY,
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{ $ref: "#/components/parameters/Cursor" },
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
				],
				responses: envelope("blocks"),
			},
		},
		"/v1/index/blocks/{height_or_hash}": {
			get: {
				tags: ["index"],
				summary: "Block by height or hash",
				security: READ_SECURITY,
				parameters: [
					{
						name: "height_or_hash",
						in: "path",
						required: true,
						schema: { type: "string", example: "182447" },
					},
				],
				responses: ok(),
			},
		},
		"/v1/index/transactions": {
			get: {
				tags: ["index"],
				summary: "Full transaction documents",
				security: READ_SECURITY,
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{
						name: "cursor",
						in: "query",
						schema: { type: "string", example: "7960000:3" },
					},
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					qp("type", "string"),
					qp("sender", "string"),
					qp("contract_id", "string"),
				],
				responses: envelope("transactions"),
			},
		},
		"/v1/index/transactions/{tx_id}": {
			get: {
				tags: ["index"],
				summary: "Transaction by tx_id",
				security: READ_SECURITY,
				parameters: [
					{
						name: "tx_id",
						in: "path",
						required: true,
						schema: { type: "string" },
					},
				],
				responses: ok(),
			},
		},
		"/v1/index/transactions/{tx_id}/proof": {
			get: {
				tags: ["index"],
				summary:
					"Trustless tx-inclusion proof (raw tx, Nakamoto header, merkle path)",
				security: READ_SECURITY,
				parameters: [
					{
						name: "tx_id",
						in: "path",
						required: true,
						schema: { type: "string" },
					},
				],
				responses: ok(),
			},
		},
		"/v1/index/stacking": {
			get: {
				tags: ["index"],
				summary: "PoX-4 stacking actions",
				security: READ_SECURITY,
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{
						name: "cursor",
						in: "query",
						schema: { type: "string", example: "7960000:3" },
					},
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					qp("function_name", "string"),
					qp("stacker", "string"),
					qp("caller", "string"),
				],
				responses: envelope("stacking"),
			},
		},
		"/v1/index/pox/cycles": {
			get: {
				tags: ["index"],
				summary: "PoX-4 reward-cycle aggregates",
				description:
					"Per-cycle rollup over pox4_calls: total stacked ustx, unique stackers/delegators, action count, block range, function breakdown. Cursor-paginated by reward_cycle descending; may carry an optional `notes` field (decoder disabled, or PoX-4 era closed at the epoch 4.0 fork).",
				security: READ_SECURITY,
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{
						name: "cursor",
						in: "query",
						schema: { type: "integer", example: 84 },
						description: "Reward cycle to page backward from (exclusive).",
					},
				],
				responses: {
					"200": {
						description: "Cursor-paginated reward-cycle list",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										cycles: { type: "array", items: { type: "object" } },
										next_cursor: { type: ["integer", "null"], example: 83 },
										tip: { $ref: "#/components/schemas/Tip" },
										notes: { type: "string" },
									},
								},
							},
						},
					},
					"400": jsonError(),
					"401": jsonError(),
					"429": jsonError(),
				},
			},
		},
		"/v1/index/pox/cycles/{reward_cycle}": {
			get: {
				tags: ["index"],
				summary: "PoX-4 reward-cycle aggregate by cycle number",
				security: READ_SECURITY,
				parameters: [
					{
						name: "reward_cycle",
						in: "path",
						required: true,
						schema: { type: "integer", example: 142 },
					},
				],
				responses: {
					"200": {
						description: "OK",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										cycle: { type: "object" },
										tip: { $ref: "#/components/schemas/Tip" },
										notes: { type: "string" },
									},
								},
							},
						},
					},
					"400": {
						description: "reward_cycle is not a non-negative integer",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
							},
						},
					},
					"404": {
						description: "No cycle found for reward_cycle",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
							},
						},
					},
				},
			},
		},
		"/v1/index/pox5/events": {
			get: {
				tags: ["index"],
				summary: "PoX-5 boot-contract events (decoded)",
				description:
					"Decoded print log of the pox-5 boot contract (SIP-045 Bitcoin Staking) — all 19 topics (stake, stake-update, register-signer, unstake, claim-rewards, etc.), one row per print. Starts at the epoch 4.0 hard fork, where /v1/index/stacking's pox-4 feed ends.",
				security: READ_SECURITY,
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{
						name: "cursor",
						in: "query",
						schema: { type: "string", example: "7960000:3" },
					},
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					qp("confirmed", "boolean"),
					qp("topic", "string"),
					qp("staker", "string"),
					qp("signer", "string"),
					qp("signer_manager", "string"),
					qp("bond_index", "integer"),
					qp("reward_cycle", "integer"),
					qp("fields", "string"),
				],
				responses: envelope("events"),
			},
		},
		"/v1/index/sbtc/events": {
			get: {
				tags: ["index"],
				summary: "sBTC peg events (decoded)",
				description:
					"Decoded sBTC peg protocol-state events Hiro declined to filter (SBA #1709): completed-deposit, withdrawal-create/accept/reject, key-rotation, update-protocol-contract.",
				security: READ_SECURITY,
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{
						name: "cursor",
						in: "query",
						schema: { type: "string", example: "7960000:3" },
					},
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					qp("confirmed", "boolean"),
					qp("topic", "string"),
					qp("sender", "string"),
					qp("request_id", "integer"),
					qp("bitcoin_txid", "string"),
				],
				responses: envelope("events"),
			},
		},
		"/v1/index/sbtc/deposits": {
			get: {
				tags: ["index"],
				summary: "sBTC peg-ins (completed deposits)",
				security: READ_SECURITY,
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{
						name: "cursor",
						in: "query",
						schema: { type: "string", example: "7960000:3" },
					},
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					qp("confirmed", "boolean"),
					qp("sender", "string"),
					qp("bitcoin_txid", "string"),
				],
				responses: envelope("deposits"),
			},
		},
		"/v1/index/sbtc/withdrawals": {
			get: {
				tags: ["index"],
				summary: "sBTC peg-outs (lifecycle, one per request_id)",
				description:
					"Peg-outs rolled up per request_id with derived status (REQUESTED→ACCEPTED|REJECTED) and the committed BTC sweep_txid. Never immutably cached (status mutates as later events land).",
				security: READ_SECURITY,
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{
						name: "cursor",
						in: "query",
						schema: { type: "string", example: "7960000:3" },
					},
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					qp("confirmed", "boolean"),
					qp("status", "string"),
					qp("sender", "string"),
					qp("request_id", "integer"),
					qp("settlement_confirmed", "boolean"),
				],
				responses: envelope("withdrawals"),
			},
		},
		"/v1/index/sbtc/withdrawals/{request_id}": {
			get: {
				tags: ["index"],
				summary: "sBTC peg-out lifecycle by request_id",
				security: READ_SECURITY,
				parameters: [
					{
						name: "request_id",
						in: "path",
						required: true,
						schema: { type: "integer", example: 42 },
					},
				],
				responses: ok(),
			},
		},
		"/v1/index/sbtc/deposits/{bitcoin_txid}": {
			get: {
				tags: ["index"],
				summary: "sBTC peg-in by Bitcoin txid",
				security: READ_SECURITY,
				parameters: [
					{
						name: "bitcoin_txid",
						in: "path",
						required: true,
						schema: { type: "string" },
					},
				],
				responses: ok(),
			},
		},
		"/v1/index/sbtc/summary": {
			get: {
				tags: ["index"],
				summary: "sBTC peg summary scoreboard",
				description:
					"One scalar aggregate over the whole bridge: lifecycle counts, net peg flow, locked sats, and circulating sBTC supply (mints − burns). All-time canonical totals; no params.",
				security: READ_SECURITY,
				parameters: [],
				responses: ok(),
			},
		},
		"/v1/index/mempool": {
			get: {
				tags: ["index"],
				summary: "Pending (unconfirmed) transactions",
				security: READ_SECURITY,
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{
						name: "cursor",
						in: "query",
						schema: { type: "string", example: "10428" },
					},
					qp("from_cursor", "string"),
					qp("sender", "string"),
					qp("type", "string"),
					qp("function_name", "string"),
				],
				responses: envelope("mempool"),
			},
		},
		"/v1/index/mempool/{tx_id}": {
			get: {
				tags: ["index"],
				summary: "Pending transaction by tx_id",
				security: READ_SECURITY,
				parameters: [
					{
						name: "tx_id",
						in: "path",
						required: true,
						schema: { type: "string" },
					},
				],
				responses: ok(),
			},
		},
		"/v1/index/contracts/{contract_id}/print-schema": {
			get: {
				tags: ["index"],
				summary: "Empirical per-topic print payload schemas for a contract",
				security: READ_SECURITY,
				parameters: [pp("contract_id")],
				responses: ok(),
			},
		},
		"/v1/streams": {
			get: {
				tags: ["streams"],
				summary: "Streams discovery",
				security: READ_SECURITY,
				responses: ok(),
			},
		},
		"/v1/streams/events": {
			get: {
				tags: ["streams"],
				summary: "Raw event firehose",
				security: READ_SECURITY,
				parameters: [
					{ $ref: "#/components/parameters/Limit" },
					{ $ref: "#/components/parameters/Cursor" },
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("to_height", "integer"),
					qp("types", "string"),
					qp("contract_id", "string"),
				],
				responses: envelope(),
			},
		},
		"/v1/streams/events/stream": {
			get: {
				tags: ["streams"],
				summary: "SSE tail of the raw event firehose (same filters as /events)",
				security: READ_SECURITY,
				parameters: [
					{ $ref: "#/components/parameters/Cursor" },
					qp("from_cursor", "string"),
					qp("from_height", "integer"),
					qp("types", "string"),
					qp("contract_id", "string"),
				],
				responses: ok(),
			},
		},
		"/v1/streams/reorgs": {
			get: {
				tags: ["streams"],
				summary: "Chain reorg history",
				security: READ_SECURITY,
				parameters: [
					qp("since", "string"),
					{ $ref: "#/components/parameters/Limit" },
				],
				responses: ok(),
			},
		},
		"/v1/streams/canonical/{height}": {
			get: {
				tags: ["streams"],
				summary: "Canonical block by height",
				security: READ_SECURITY,
				parameters: [
					{
						name: "height",
						in: "path",
						required: true,
						schema: { type: "integer" },
					},
				],
				responses: ok(),
			},
		},
		"/v1/streams/tip": {
			get: {
				tags: ["streams"],
				summary: "Current chain tip",
				security: READ_SECURITY,
				responses: ok(),
			},
		},

		// ── Write plane (`/api`) ─────────────────────────────────────────────
		// The documented path for deploying and driving work on an instance.
		// Mounted in oss only; `openapiSpec("platform")` drops every path under
		// WORKLOAD_OPENAPI_PREFIXES because the metered archive 404s them.
		"/api/subgraphs": {
			get: {
				tags: ["deployments"],
				summary:
					"List deployed subgraphs with status, sync lag, and row counts",
				security: WRITE_SECURITY,
				responses: apiReadResponses(),
			},
			post: {
				tags: ["deployments"],
				summary: "Deploy or redeploy a subgraph",
				description:
					"Takes bundled handler code (see `/api/subgraphs/bundle`) plus the schema and sources extracted from it. Redeploying the same name updates in place; the response `action` says what happened (`created`, `unchanged`, `handler_updated`, `updated`, `reindexed`). `dryRun` validates without writing.",
				security: WRITE_SECURITY,
				requestBody: jsonBody({
					type: "object",
					required: ["name", "sources", "schema", "handlerCode"],
					properties: {
						name: {
							type: "string",
							maxLength: 63,
							pattern: "^[a-z0-9-]+$",
							description: "Lowercase alphanumeric and hyphens.",
						},
						sources: {
							type: "object",
							description:
								"At least one event source, keyed by name. Extracted from the handler module.",
						},
						schema: { type: "object", description: "Table definitions." },
						handlerCode: {
							type: "string",
							description: "Bundled handler module, 1 MB max.",
						},
						startBlock: {
							type: "integer",
							minimum: 0,
							description:
								"First block to index. Rejected (400 `START_BLOCK_PAST_TIP`) when it is past the chain tip.",
						},
						version: { type: "string" },
						description: { type: "string" },
						sourceCode: {
							type: "string",
							description: "Unbundled source, kept for `sl subgraph source`.",
						},
						dryRun: { type: "boolean" },
					},
				}),
				responses: writeResponses(),
			},
		},
		"/api/subgraphs/bundle": {
			post: {
				tags: ["deployments"],
				summary: "Bundle subgraph source into deployable handler code",
				description:
					"Compiles a subgraph module and returns `{ name, sources, schema, handlerCode }` ready to POST to `/api/subgraphs`. Deploys nothing.",
				security: WRITE_SECURITY,
				requestBody: jsonBody({
					type: "object",
					required: ["code"],
					properties: {
						code: { type: "string", description: "Subgraph module source." },
					},
				}),
				responses: writeResponses({
					"413": jsonError(
						"Bundle exceeds the size limit (`BUNDLE_TOO_LARGE`)",
					),
				}),
			},
		},
		"/api/subgraphs/{name}": {
			get: {
				tags: ["deployments"],
				summary: "Deployed subgraph detail: definition, status, operations",
				security: WRITE_SECURITY,
				parameters: [pp("name")],
				responses: apiReadResponses({ "404": jsonError() }),
			},
			delete: {
				tags: ["deployments"],
				summary: "Delete a subgraph and drop its schema",
				description:
					"Cancels any running operation, waits for the processor to release it, then drops the Postgres schema and the registry row. Irreversible.",
				security: WRITE_SECURITY,
				parameters: [
					pp("name"),
					qp(
						"force",
						"boolean",
						false,
						"Proceed even when an active operation has not cleared.",
					),
				],
				responses: writeResponses({ "404": jsonError() }),
			},
		},
		"/api/subgraphs/{name}/reindex": {
			post: {
				tags: ["deployments"],
				summary: "Queue a full reindex (drops and rebuilds the schema)",
				description:
					"Always rebuilds the whole subgraph from its start block — a `fromBlock`/`toBlock` body is rejected with 400 `REINDEX_RANGE_NOT_SUPPORTED` rather than silently destroying everything outside the range; use `backfill` for a range. Returns an `operationId` to poll on `/api/subgraphs/{name}/operations`.",
				security: WRITE_SECURITY,
				parameters: [pp("name")],
				responses: writeResponses({
					"404": jsonError(),
					"409": jsonError(
						"A reindex or backfill is already running (`OPERATION_IN_PROGRESS`)",
					),
				}),
			},
		},
		"/api/subgraphs/{name}/backfill": {
			post: {
				tags: ["deployments"],
				summary: "Queue a non-destructive backfill over a block range",
				description:
					"Re-runs handlers over `[fromBlock, toBlock]` without dropping data. Refused with 422 when the handlers apply deltas (`ctx.increment`/`patchOrInsert`/`update`), which would double-count on blocks already processed.",
				security: WRITE_SECURITY,
				parameters: [pp("name")],
				requestBody: jsonBody({
					type: "object",
					required: ["fromBlock", "toBlock"],
					properties: {
						fromBlock: { type: "integer" },
						toBlock: { type: "integer" },
					},
				}),
				responses: writeResponses({
					"404": jsonError(),
					"409": jsonError(
						"A reindex or backfill is already running (`OPERATION_IN_PROGRESS`)",
					),
					"422": jsonError(
						"Handlers apply deltas and cannot be replayed (`BACKFILL_NON_REPLAYABLE_HANDLER`)",
					),
				}),
			},
		},
		"/api/subgraphs/{name}/stop": {
			post: {
				tags: ["deployments"],
				summary: "Request cancellation of the running reindex or backfill",
				description:
					"Body-less. Marks the active operation `cancel_requested`; the processor releases it at its next checkpoint.",
				security: WRITE_SECURITY,
				parameters: [pp("name")],
				responses: writeResponses({
					"404": jsonError("No active operation (`NO_OPERATION`)"),
				}),
			},
		},
		"/api/subgraphs/{name}/operations": {
			get: {
				tags: ["deployments"],
				summary: "Reindex/backfill history with queue position and progress",
				security: WRITE_SECURITY,
				parameters: [pp("name")],
				responses: apiReadResponses({ "404": jsonError() }),
			},
		},
		"/api/subgraphs/{name}/operations/{operation_id}": {
			get: {
				tags: ["deployments"],
				summary: "One operation by id (poll a queued reindex or backfill)",
				security: WRITE_SECURITY,
				parameters: [pp("name"), pp("operation_id")],
				responses: apiReadResponses({ "404": jsonError() }),
			},
		},
		"/api/subgraphs/{name}/gaps": {
			get: {
				tags: ["deployments"],
				summary: "Block ranges this subgraph has not processed",
				security: WRITE_SECURITY,
				parameters: [
					pp("name"),
					qp("_limit", "integer", false, `Page size, 1–${MAX_LIMIT}.`),
					qp("_offset", "integer"),
					qp(
						"resolved",
						"string",
						false,
						'"true" for resolved gaps, "all" for both; unresolved only by default.',
					),
				],
				responses: apiReadResponses({ "404": jsonError() }),
			},
		},
		"/api/subscriptions": {
			get: {
				tags: ["subscriptions"],
				summary: "List webhook subscriptions",
				security: WRITE_SECURITY,
				parameters: [
					qp("_limit", "integer", false, "Page size, 1–200 (default 50)."),
					qp("_offset", "integer"),
				],
				responses: apiReadResponses(),
			},
			post: {
				tags: ["subscriptions"],
				summary: "Create a webhook subscription",
				description:
					"Two mutually exclusive modes: a subgraph subscription (`subgraphName` + `tableName`, optional column `filter`) or a chain subscription (`triggers`). Responds 201 with the signing secret — the only time it is returned in full.",
				security: WRITE_SECURITY,
				requestBody: jsonBody({
					type: "object",
					required: ["name", "url"],
					properties: {
						name: { type: "string" },
						url: { type: "string", description: "HTTPS delivery target." },
						subgraphName: { type: "string" },
						tableName: { type: "string" },
						filter: {
							type: "object",
							description: "Column filter on the subgraph table.",
						},
						triggers: {
							type: "array",
							items: { type: "object" },
							description:
								"Chain-event triggers; mutually exclusive with `subgraphName`/`tableName`.",
						},
						format: {
							type: "string",
							default: "standard-webhooks",
						},
						runtime: { type: ["string", "null"] },
						authConfig: { type: "object" },
						maxRetries: { type: "integer", minimum: 0, maximum: 100 },
						timeoutMs: { type: "integer", minimum: 100, maximum: 300000 },
						concurrency: { type: "integer", minimum: 1, maximum: 100 },
					},
				}),
				responses: writeResponses({
					"201": {
						description: "Created; body carries the signing secret once",
						content: { "application/json": {} },
					},
					"409": jsonError("A subscription with that name exists"),
				}),
			},
		},
		"/api/subscriptions/{id}": {
			get: {
				tags: ["subscriptions"],
				summary: "Subscription detail",
				security: WRITE_SECURITY,
				parameters: [pp("id")],
				responses: apiReadResponses({ "404": jsonError() }),
			},
			patch: {
				tags: ["subscriptions"],
				summary: "Update a subscription",
				security: WRITE_SECURITY,
				parameters: [pp("id")],
				requestBody: jsonBody({
					type: "object",
					properties: {
						name: { type: "string" },
						url: { type: "string" },
						filter: { type: "object" },
						format: { type: "string" },
						runtime: { type: ["string", "null"] },
						authConfig: { type: "object" },
						maxRetries: { type: "integer" },
						timeoutMs: { type: "integer" },
						concurrency: { type: "integer" },
					},
				}),
				responses: writeResponses({ "404": jsonError() }),
			},
			delete: {
				tags: ["subscriptions"],
				summary: "Delete a subscription",
				security: WRITE_SECURITY,
				parameters: [pp("id")],
				responses: writeResponses({ "404": jsonError() }),
			},
		},
		"/api/subscriptions/{id}/pause": {
			post: {
				tags: ["subscriptions"],
				summary: "Pause delivery (body-less)",
				security: WRITE_SECURITY,
				parameters: [pp("id")],
				responses: writeResponses({ "404": jsonError() }),
			},
		},
		"/api/subscriptions/{id}/resume": {
			post: {
				tags: ["subscriptions"],
				summary: "Resume delivery (body-less)",
				security: WRITE_SECURITY,
				parameters: [pp("id")],
				responses: writeResponses({ "404": jsonError() }),
			},
		},
		"/api/subscriptions/{id}/rotate-secret": {
			post: {
				tags: ["subscriptions"],
				summary: "Rotate the signing secret (body-less)",
				description:
					"Returns the new secret once. Deliveries signed with the old secret stop verifying immediately.",
				security: WRITE_SECURITY,
				parameters: [pp("id")],
				responses: writeResponses({ "404": jsonError() }),
			},
		},
		"/api/subscriptions/{id}/test": {
			post: {
				tags: ["subscriptions"],
				summary: "Send a one-off test delivery (body-less)",
				description:
					"Builds a sample event in the subscription's format, posts it to the configured URL through the SSRF guard, and records it under deliveries.",
				security: WRITE_SECURITY,
				parameters: [pp("id")],
				responses: writeResponses({ "404": jsonError() }),
			},
		},
		"/api/subscriptions/{id}/deliveries": {
			get: {
				tags: ["subscriptions"],
				summary: "Last 100 delivery attempts, newest first",
				security: WRITE_SECURITY,
				parameters: [pp("id")],
				responses: apiReadResponses({ "404": jsonError() }),
			},
		},
		"/api/subscriptions/{id}/dead": {
			get: {
				tags: ["subscriptions"],
				summary: "Dead-letter queue: events that exhausted their retries",
				security: WRITE_SECURITY,
				parameters: [pp("id")],
				responses: apiReadResponses({ "404": jsonError() }),
			},
		},
		"/api/subscriptions/{id}/dead/{outbox_id}/requeue": {
			post: {
				tags: ["subscriptions"],
				summary: "Requeue one dead event at live priority (body-less)",
				security: WRITE_SECURITY,
				parameters: [pp("id"), pp("outbox_id")],
				responses: writeResponses({ "404": jsonError() }),
			},
		},
		"/api/subscriptions/{id}/replay": {
			post: {
				tags: ["subscriptions"],
				summary: "Replay a block range through a subscription",
				description:
					"Queues historical events for redelivery; replays drain through a 10% share of the outbox so live traffic keeps priority. 202 on accept.",
				security: WRITE_SECURITY,
				parameters: [pp("id")],
				requestBody: jsonBody({
					type: "object",
					required: ["fromBlock", "toBlock"],
					properties: {
						fromBlock: { type: "integer" },
						toBlock: { type: "integer" },
						force: {
							type: "string",
							description:
								"Suffix that makes the replay ids unique, so an already-replayed range can be sent again.",
						},
					},
				}),
				responses: writeResponses({
					"202": {
						description: "Replay queued",
						content: { "application/json": {} },
					},
					"404": jsonError(),
				}),
			},
		},
		"/api/node/contracts/{contract_id}/abi": {
			get: {
				tags: ["node"],
				summary: "Clarity contract ABI, proxied from the local Stacks node",
				security: WRITE_SECURITY,
				parameters: [pp("contract_id")],
				responses: apiReadResponses({
					"404": jsonError("Contract not found"),
					"502": jsonError("The node did not answer"),
				}),
			},
		},
	},
};

/**
 * The document above describes a self-hosted instance, which is the product
 * every operator runs. The metered archive deployment is the specialization,
 * so it is derived here rather than the other way round:
 *
 *  - the workload plane is not mounted there (it 404s — `route-manifest.ts`),
 *    so those paths are dropped;
 *  - Streams is keyed there whatever the bind (`streams/auth.ts` passes
 *    `platform: false`), so its bearer becomes required rather than optional;
 *  - the credential there is a minted account key, not an instance token.
 */
function platformSpec(): typeof OPENAPI_SPEC {
	const paths: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(OPENAPI_SPEC.paths)) {
		if (isWorkloadPath(key)) continue;
		paths[key] = key.startsWith("/v1/streams") ? keyedOperations(value) : value;
	}
	return {
		...OPENAPI_SPEC,
		info: {
			...OPENAPI_SPEC.info,
			description:
				"The metered public archive. Index and Subgraph reads are open; Streams requires a key on every request. Credentials are account API keys (`sk-sl_*`) sent as `Authorization: Bearer`. The workload plane (`/api/subgraphs`, `/api/subscriptions`, `/api/node`) is not served here — deploying and running handler code is what a self-hosted instance is for.",
		},
		tags: OPENAPI_SPEC.tags.filter(
			(tag) =>
				!WORKLOAD_TAGS.includes(tag.name as (typeof WORKLOAD_TAGS)[number]),
		),
		components: {
			...OPENAPI_SPEC.components,
			securitySchemes: {
				bearerAuth: {
					type: "http",
					scheme: "bearer",
					bearerFormat: "sk-sl_*",
					description:
						"Account API key minted by the archive. Required on Streams; optional elsewhere, where it identifies the account for metering.",
				},
			},
		},
		paths,
	} as typeof OPENAPI_SPEC;
}

/** Tags that only exist on the write plane. */
const WORKLOAD_TAGS = ["deployments", "subscriptions", "node"] as const;

function isWorkloadPath(path: string): boolean {
	return WORKLOAD_OPENAPI_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Re-declare every operation on a path item as bearer-required. */
function keyedOperations(item: unknown): unknown {
	const entries = Object.entries(
		item as Record<string, Record<string, unknown>>,
	);
	return Object.fromEntries(
		entries.map(([method, op]) => [
			method,
			{ ...op, security: WRITE_SECURITY },
		]),
	);
}

/** OSS drops any hosted-only paths (currently none) and rewrites `/v1/instance`. */
export function openapiSpec(
	mode: InstanceMode = getInstanceMode(),
): typeof OPENAPI_SPEC {
	if (mode === "platform") return platformSpec();
	const paths: Record<string, unknown> = { ...OPENAPI_SPEC.paths };
	for (const key of HOSTED_OPENAPI_PATHS) {
		delete paths[key];
	}
	paths["/v1/instance"] = {
		get: {
			tags: ["instance"],
			summary: "Local instance catalog",
			description:
				"Instance status, local subgraphs, subscriptions, and default features. No signup or pricing.",
			security: READ_SECURITY,
			responses: ok(),
		},
	};
	paths["/v1/instance/features"] = {
		get: {
			tags: ["instance"],
			summary: "Default feature manifest",
			security: READ_SECURITY,
			responses: ok(),
		},
	};
	return {
		openapi: OPENAPI_SPEC.openapi,
		info: {
			...OPENAPI_SPEC.info,
			description: `This instance: Index (decoded chain events), Streams (raw firehose), Subgraphs (the schemas you deployed), and the \`/api\` write plane that deploys and drives them. Cursor format is \`<block_height>:<event_index>\` on Index/Streams; opaque on Subgraphs. ${AUTH_DESCRIPTION}`,
		},
		servers: [{ url: "/", description: "This instance" }],
		// `instance` exists only on a self-hosted box, so it is declared here
		// rather than in the shared tag list.
		tags: [
			...OPENAPI_SPEC.tags,
			{
				name: "instance",
				description: "What this instance is, holds, and has enabled",
			},
		],
		components: OPENAPI_SPEC.components,
		paths,
	} as typeof OPENAPI_SPEC;
}

function qp(
	name: string,
	type: string,
	required = false,
	description?: string,
) {
	return {
		name,
		in: "query",
		required,
		schema: { type },
		...(description ? { description } : {}),
	};
}

function pp(name: string) {
	return { name, in: "path", required: true, schema: { type: "string" } };
}

/** Every `/v1` read can 401: the credential is optional on a loopback bind and
 *  required once the instance is reachable past it. */
function ok() {
	return {
		"200": { description: "OK", content: { "application/json": {} } },
		"400": jsonError(),
		"401": jsonError(),
	};
}

/** Reads under `/api`. The instance token is required whenever one is set, and
 *  GET is not subject to the JSON content-type guard. */
function apiReadResponses(extra: Record<string, unknown> = {}) {
	return {
		"200": { description: "OK", content: { "application/json": {} } },
		"401": jsonError(),
		...extra,
	};
}

/**
 * Writes under `/api`. 415 is `middleware/csrf.ts`: a write must declare
 * `Content-Type: application/json`, the one header a browser cannot set
 * cross-origin without a preflight this API's CORS policy gets to refuse.
 * Body-less action writes (`/stop`, `/pause`, `/rotate-secret`) are allowed
 * without the header only when they also carry no `Origin`, so first-party
 * callers should send it unconditionally.
 */
function writeResponses(extra: Record<string, unknown> = {}) {
	return {
		"200": { description: "OK", content: { "application/json": {} } },
		"400": jsonError(),
		"401": jsonError(),
		"415": jsonError(
			"Missing or non-JSON `Content-Type` (`UNSUPPORTED_MEDIA_TYPE`) — writes must send `Content-Type: application/json`",
		),
		...extra,
	};
}

function jsonBody(schema: Record<string, unknown>) {
	return {
		required: true,
		content: { "application/json": { schema } },
	};
}

function envelope(_arrayKey = "events") {
	return {
		"200": {
			description: "Cursor-paginated envelope",
			content: {
				"application/json": {
					schema: { $ref: "#/components/schemas/CursorEnvelope" },
				},
			},
		},
		"400": jsonError(),
		"401": jsonError(),
		"429": jsonError(),
		"503": {
			description: "Tip unavailable",
			content: { "application/json": {} },
		},
	};
}

function rowsEnvelope() {
	return {
		"200": {
			description:
				"Row envelope, _id keyset cursor by default (composite with the sort column when _sort is used)",
			content: {
				"application/json": {
					schema: { $ref: "#/components/schemas/RowsEnvelope" },
				},
			},
		},
		"400": jsonError(),
		"401": jsonError(),
		"404": jsonError(),
		"429": jsonError(),
	};
}

function jsonError(description = "Error") {
	return {
		description,
		content: {
			"application/json": {
				schema: { $ref: "#/components/schemas/Error" },
			},
		},
	};
}

export function createOpenApiRouter() {
	const router = new Hono();
	router.get("/", (c) => c.json(openapiSpec()));
	return router;
}

export default createOpenApiRouter();
