import type { SubgraphDetail } from "@secondlayer/shared/schemas/subgraphs";
import {
	generateSubgraphAgentSchema,
	generateSubgraphMarkdown,
	generateSubgraphOpenApi,
} from "@secondlayer/shared/subgraphs/spec";
import { TYPE_MAP } from "@secondlayer/subgraphs/schema";
import {
	COMPARISON_OPS,
	DEFAULT_LIMIT,
	IN_OPS,
	MAX_AGGREGATE_COLUMNS,
	MAX_LIMIT,
} from "../subgraph-query-helpers.ts";
import {
	ERROR_400,
	ERROR_401,
	READ_SECURITY,
	jsonError,
	pp,
	qp,
} from "./shared.ts";

/**
 * `/v1/subgraphs` reads (`../v1-subgraphs.ts`, row cores in
 * `../../subgraphs/read-core.ts`, grammar in `../subgraph-query-helpers.ts`).
 *
 * Subgraph tables are user-defined, so rows are documented generically: the
 * four system columns every table carries, plus the JSON type each column
 * type comes back as. The worked example is the table `sl subgraphs scaffold`
 * writes for the sBTC token, filled with a real sBTC transfer from mainnet
 * block 9048926.
 */

// ── Example subgraph ────────────────────────────────────────────────────

const EXAMPLE_NAME = "sbtc-token";
const EXAMPLE_TABLE = "transfers";
const EXAMPLE_SERVER = "http://127.0.0.1:3800";
const SBTC_ASSET =
	"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";
const EXAMPLE_SOURCES = {
	transfers: { type: "ft_transfer", assetIdentifier: SBTC_ASSET },
};
const EXAMPLE_COLUMNS = {
	sender: { type: "principal" },
	recipient: { type: "principal" },
	amount: { type: "uint" },
	asset_identifier: { type: "text", indexed: true },
};
const EXAMPLE_TIP = {
	block_height: 9048931,
	subgraph_height: 9048931,
	blocks_behind: 0,
};
const EXAMPLE_ROWS = 48138;

/** As the route returns it: BIGINT and NUMERIC come back as strings. */
const EXAMPLE_ROW = {
	_id: "48138",
	_block_height: "9048926",
	_tx_id: "0x926f5ff4326155dea077126d21810fc7954568647898dbfb2f66a28b880dc5c9",
	_created_at: "2026-09-23T15:10:29.114Z",
	sender: "SP1TPYSSG52FKCDHHN8Y76ABMA12P069BZBFAYEAF",
	recipient: "SP3EWCDA3V8HCP64CSETSNYXZ25WC4AJ95EC0ZEST.zr-d-0",
	amount: "14000",
	asset_identifier: SBTC_ASSET,
};

/** What `buildSubgraphDetailFromRow` hands the doc generators for it. */
const EXAMPLE_DETAIL: SubgraphDetail = {
	name: EXAMPLE_NAME,
	version: "1.0.0",
	schemaHash:
		"fffc99aeb7e11b465bf2b91ff67f3b4fcafc7bfbd447fe4d1d36d3bb4b867c2f",
	status: "active",
	visibility: "private",
	lastProcessedBlock: EXAMPLE_TIP.subgraph_height,
	sources: EXAMPLE_SOURCES,
	health: {
		totalProcessed: EXAMPLE_ROWS,
		totalErrors: 0,
		errorRate: 0,
		lastError: null,
		lastErrorAt: null,
		emptyMapping: false,
	},
	sync: {
		status: "synced",
		startBlock: 0,
		lastProcessedBlock: EXAMPLE_TIP.subgraph_height,
		chainTip: EXAMPLE_TIP.block_height,
		blocksRemaining: 0,
		progress: 1,
		gaps: { count: 0, totalMissingBlocks: 0, ranges: [] },
		integrity: "complete",
	},
	tables: {
		[EXAMPLE_TABLE]: {
			endpoint: `/subgraphs/${EXAMPLE_NAME}/${EXAMPLE_TABLE}`,
			columns: {
				...EXAMPLE_COLUMNS,
				_id: { type: "serial" },
				_block_height: { type: "bigint" },
				_tx_id: { type: "text" },
				_created_at: { type: "timestamp" },
			},
			rowCount: EXAMPLE_ROWS,
			example: `/subgraphs/${EXAMPLE_NAME}/${EXAMPLE_TABLE}?_sort=_block_height&_order=desc&_limit=10`,
		},
	},
	createdAt: "2026-09-01T12:00:00.000Z",
	updatedAt: "2026-09-23T15:10:29.114Z",
};

/** Self-hosted reads document the `/v1` surface (`readSpecOptions`). */
const EXAMPLE_SPEC_OPTIONS = {
	serverUrl: EXAMPLE_SERVER,
	generatedAt: "2026-09-23T15:12:00.000Z",
	forcePublicRead: true,
};

// ── Shared fragments ────────────────────────────────────────────────────

const NAME_PARAM = pp(
	"name",
	"Subgraph name, as deployed (the `name` in its definition).",
);
const TABLE_PARAM = pp(
	"table",
	"Table name, one of the keys of the definition's `schema`. `GET /v1/subgraphs/{name}` lists them.",
);

const SUBGRAPH_404 =
	"No readable subgraph by that name (`SUBGRAPH_NOT_FOUND`). Hosted: another account's private subgraph reads as missing";
const TABLE_404 =
	"No readable subgraph by that name (`SUBGRAPH_NOT_FOUND`), or it has no such table (`TABLE_NOT_FOUND`)";
const HOSTED_429 =
	"Hosted only: rate limited; retry after `Retry-After` seconds. Self-hosted reads are not rate limited";

const OPS = [...Object.keys(COMPARISON_OPS), ...Object.keys(IN_OPS)];

/** Free-form column filters: one query param per filter, so the object form. */
const FILTERS_PARAM = {
	name: "filters",
	in: "query",
	required: false,
	style: "form",
	explode: true,
	schema: {
		type: "object",
		additionalProperties: { type: "string" },
		example: {
			sender: "SP1TPYSSG52FKCDHHN8Y76ABMA12P069BZBFAYEAF",
			"amount.gte": "10000",
		},
	},
	description: `Column filters, one query param each, ANDed. Any table column or system column (\`_id\`, \`_block_height\`, \`_tx_id\`, \`_created_at\`) works. \`col=value\` is equality; \`col.op=value\` applies an operator, one of ${OPS.map((op) => `\`${op}\``).join(", ")}. \`like\` is a case-insensitive contains match. \`in\` and \`notIn\` take a comma-separated list. An unknown column is 400 \`INVALID_COLUMN\`; an unknown operator, or the misplaced form \`col=op.value\`, is 400 \`VALIDATION_ERROR\`. Bare \`limit\`, \`offset\`, \`sort\`, \`order\`, \`fields\` and \`search\` are 400: control params take a leading underscore.`,
};

const SEARCH_PARAM = qp(
	"_search",
	"string",
	false,
	"Case-insensitive contains match across every column marked `search: true` in the definition, ORed. 400 on a table with no searchable column.",
);

function responses(
	success: Record<string, unknown>,
	extra: Record<string, unknown>,
) {
	return {
		"200": success,
		...extra,
		"401": jsonError(ERROR_401),
		"429": jsonError(HOSTED_429),
	};
}

function jsonSuccess(description: string, schema: Record<string, unknown>) {
	return { description, content: { "application/json": { schema } } };
}

/** The three generated-doc routes share one parameter set. */
const SERVER_PARAM = qp(
	"server",
	"string",
	false,
	"Base URL written into the document's endpoints and examples. Defaults to this request's origin, honoring `X-Forwarded-Proto`.",
);

// ── Paths ───────────────────────────────────────────────────────────────

export const subgraphsPaths = {
	"/v1/subgraphs": {
		get: {
			tags: ["subgraphs"],
			summary: "List the subgraphs this instance serves",
			description:
				"Every subgraph deployed on this instance, with its tables, sync position, and approximate row count. Hosted: your account's subgraphs, then every public one. The anonymous list is cached for 30 seconds and carries an `ETag`; send `If-None-Match` for a 304.",
			security: READ_SECURITY,
			responses: {
				...responses(
					jsonSuccess("The subgraph directory", {
						$ref: "#/components/schemas/SubgraphDirectory",
					}),
					{},
				),
				"304": {
					description:
						"Anonymous request whose `If-None-Match` matches the current `ETag`; no body",
				},
			},
		},
	},
	"/v1/subgraphs/{name}": {
		get: {
			tags: ["subgraphs"],
			summary: "Get one subgraph's tables, columns, and sync tip",
			description:
				"Metadata for one subgraph: each table's read endpoint and declared columns, how far indexing has reached, and links to its generated docs. `columns` lists only the definition's columns; the system columns `_id`, `_block_height`, `_tx_id` and `_created_at` exist on every table too.",
			security: READ_SECURITY,
			parameters: [NAME_PARAM],
			responses: responses(
				jsonSuccess("Subgraph metadata", {
					$ref: "#/components/schemas/Subgraph",
				}),
				{ "404": jsonError(SUBGRAPH_404) },
			),
		},
	},
	"/v1/subgraphs/{name}/openapi.json": {
		get: {
			tags: ["subgraphs"],
			summary: "Get a subgraph's OpenAPI document",
			description:
				"An OpenAPI 3.1 document generated from the subgraph's definition: one list path and one count path per table, a row schema per table, and the column filters each table accepts. Feed it to a client generator.",
			security: READ_SECURITY,
			parameters: [NAME_PARAM, SERVER_PARAM],
			responses: responses(
				jsonSuccess("The generated OpenAPI document", {
					$ref: "#/components/schemas/SubgraphOpenApiDocument",
				}),
				{ "404": jsonError(SUBGRAPH_404) },
			),
		},
	},
	"/v1/subgraphs/{name}/schema.json": {
		get: {
			tags: ["subgraphs"],
			summary: "Get a subgraph's agent schema",
			description:
				"A compact JSON description of the subgraph for agents and tools: per table, its endpoints, exact row count, columns, the query params and filters it accepts, and example requests.",
			security: READ_SECURITY,
			parameters: [NAME_PARAM, SERVER_PARAM],
			responses: responses(
				jsonSuccess("The generated agent schema", {
					$ref: "#/components/schemas/SubgraphAgentSchema",
				}),
				{ "404": jsonError(SUBGRAPH_404) },
			),
		},
	},
	"/v1/subgraphs/{name}/docs.md": {
		get: {
			tags: ["subgraphs"],
			summary: "Get a subgraph's markdown docs",
			description:
				"The agent schema rendered as markdown: a section per table with its endpoints, row count, column table, query params, filters, and a curl example. Served as `text/markdown`.",
			security: READ_SECURITY,
			parameters: [NAME_PARAM, SERVER_PARAM],
			responses: responses(
				{
					description: "The generated markdown",
					content: {
						"text/markdown": {
							schema: {
								type: "string",
								example: generateSubgraphMarkdown(
									EXAMPLE_DETAIL,
									EXAMPLE_SPEC_OPTIONS,
								),
							},
						},
					},
				},
				{ "404": jsonError(SUBGRAPH_404) },
			),
		},
	},
	"/v1/subgraphs/{name}/{table}": {
		get: {
			tags: ["subgraphs"],
			summary: "List a table's rows",
			description: `Rows from one subgraph table, keyset-paginated. By default pages walk \`_id\`; \`_sort\` walks one column instead, with \`_id\` as the tiebreaker. Pass \`next_cursor\` back as \`cursor\` to continue. \`_offset\` is refused (400): deep OFFSET scans hurt on big tables. \`_limit\` defaults to ${DEFAULT_LIMIT}.`,
			security: READ_SECURITY,
			parameters: [
				NAME_PARAM,
				TABLE_PARAM,
				{
					...qp(
						"_limit",
						"integer",
						false,
						`Page size, 1 to ${MAX_LIMIT}. A non-integer, 0, a negative, or anything over ${MAX_LIMIT} is 400, not clamped.`,
					),
					schema: {
						type: "integer",
						minimum: 1,
						maximum: MAX_LIMIT,
						default: DEFAULT_LIMIT,
					},
				},
				{
					...qp(
						"cursor",
						"string",
						false,
						"The previous page's `next_cursor`, verbatim. Opaque: its shape depends on `_sort`, so never build one. A cursor issued under one `_sort`/`_order` is 400 under another.",
					),
					schema: { type: "string", example: "48138" },
				},
				qp(
					"_sort",
					"string",
					false,
					"One column to sort by. A comma list and `jsonb` columns are 400. Omit to page by `_id`.",
				),
				{
					...qp(
						"_order",
						"string",
						false,
						"Direction of the `_sort` column, or of `_id` without `_sort`. Anything but `asc` or `desc` is 400.",
					),
					schema: { type: "string", enum: ["asc", "desc"], default: "asc" },
				},
				qp(
					"_fields",
					"string",
					false,
					"Comma-separated columns to return. An unknown name is 400 `INVALID_COLUMN`. The cursor still works: `_id` and the `_sort` column are read for it and dropped from rows you did not ask them for.",
				),
				SEARCH_PARAM,
				FILTERS_PARAM,
			],
			responses: responses(
				jsonSuccess("One page of rows", {
					$ref: "#/components/schemas/SubgraphRowsPage",
				}),
				{
					"400": jsonError(ERROR_400),
					"404": jsonError(TABLE_404),
				},
			),
		},
	},
	"/v1/subgraphs/{name}/{table}/count": {
		get: {
			tags: ["subgraphs"],
			summary: "Count a table's rows",
			description:
				"How many rows match the filters. Takes the same column filters and `_search` as the row list.",
			security: READ_SECURITY,
			parameters: [
				NAME_PARAM,
				TABLE_PARAM,
				{
					...qp(
						"_count",
						"string",
						false,
						"`exact` runs COUNT(*). `estimate` reads the planner's row estimate instead, with no table scan, but only when there are no filters and no `_search`; otherwise it counts exactly. The estimate can be -1 before the table's first ANALYZE.",
					),
					schema: {
						type: "string",
						enum: ["exact", "estimate"],
						default: "exact",
					},
				},
				SEARCH_PARAM,
				FILTERS_PARAM,
			],
			responses: responses(
				jsonSuccess("The count", {
					$ref: "#/components/schemas/SubgraphRowCount",
				}),
				{
					"400": jsonError(ERROR_400),
					"404": jsonError(TABLE_404),
				},
			),
		},
	},
	"/v1/subgraphs/{name}/{table}/aggregate": {
		get: {
			tags: ["subgraphs"],
			summary: "Aggregate a table's rows",
			description: `Scalar aggregates over the rows that match the filters: count, distinct counts, and sum, min and max of numeric columns. With no aggregate param it returns \`{ "count": n }\`. Up to ${MAX_AGGREGATE_COLUMNS} aggregate columns per request. Takes the same column filters and \`_search\` as the row list.`,
			security: READ_SECURITY,
			parameters: [
				NAME_PARAM,
				TABLE_PARAM,
				qp(
					"_count",
					"string",
					false,
					"Include `count`. Any value but `false` turns it on. `count` is also returned when no other aggregate is asked for.",
				),
				qp(
					"_countDistinct",
					"string",
					false,
					"Comma-separated columns to count distinct values of. Any column.",
				),
				qp(
					"_sum",
					"string",
					false,
					"Comma-separated columns to sum. Numeric only: `uint` or `int` columns, or `_block_height`; others are 400 `NON_NUMERIC_COLUMN`.",
				),
				qp(
					"_min",
					"string",
					false,
					"Comma-separated numeric columns to take the minimum of.",
				),
				qp(
					"_max",
					"string",
					false,
					"Comma-separated numeric columns to take the maximum of.",
				),
				SEARCH_PARAM,
				FILTERS_PARAM,
			],
			responses: responses(
				jsonSuccess("The aggregates", {
					$ref: "#/components/schemas/SubgraphAggregates",
				}),
				{
					"400": jsonError(
						"A column or filter was refused: `INVALID_COLUMN`, `NON_NUMERIC_COLUMN`, `TOO_MANY_AGGREGATES`, or `VALIDATION_ERROR`",
					),
					"404": jsonError(TABLE_404),
				},
			),
		},
	},
	"/v1/subgraphs/{name}/{table}/stream": {
		get: {
			tags: ["subgraphs"],
			summary: "Stream a table's new rows (SSE)",
			description:
				"Server-Sent Events of rows as they are indexed. Starts at the table's newest row and sends only rows after it; `since` replays from a block height first, then keeps tailing. The server polls every 1.5 seconds, sends each matching row in `_id` order, and sends a `ping` event after 20 idle seconds. Column filters and `_search` apply; `_limit`, `_sort`, `_order` and `_fields` are checked but have no effect, and rows always come back whole. Nothing is stored between connections, and `Last-Event-ID` is not read: to resume, reconnect with `since`.",
			security: READ_SECURITY,
			parameters: [
				NAME_PARAM,
				TABLE_PARAM,
				{
					...qp(
						"since",
						"integer",
						false,
						"Block height to replay from: rows with `_block_height` at or above it, then the live tail. A value that is not a number is ignored. With nothing at or above it yet, the stream tails live.",
					),
					schema: { type: "integer", example: 9048900 },
				},
				SEARCH_PARAM,
				FILTERS_PARAM,
			],
			responses: responses(
				{
					description:
						"An open event stream. Each row arrives as one message: `id` is the row's `_id`, `data` is the row as JSON, in the same shape as the row list. Idle keepalives are `event: ping` with empty data.",
					content: {
						"text/event-stream": {
							schema: {
								type: "string",
								example: `id: ${EXAMPLE_ROW._id}\ndata: ${JSON.stringify(EXAMPLE_ROW)}\n\nevent: ping\ndata: \n\n`,
							},
						},
					},
				},
				{
					"400": jsonError(ERROR_400),
					"404": jsonError(TABLE_404),
				},
			),
		},
	},
	"/v1/subgraphs/{name}/{table}/{id}": {
		get: {
			tags: ["subgraphs"],
			summary: "Get one row by id",
			description:
				"One row by its `_id`, wrapped as `{ data }`. An id that isn't an integer, or no row with it, is a 404.",
			security: READ_SECURITY,
			parameters: [
				NAME_PARAM,
				TABLE_PARAM,
				{
					...pp("id", "The row's `_id`."),
					schema: { type: "string", example: EXAMPLE_ROW._id },
				},
			],
			responses: responses(
				jsonSuccess("The row.", {
					type: "object",
					properties: {
						data: { $ref: "#/components/schemas/SubgraphRow" },
					},
					example: { data: EXAMPLE_ROW },
				}),
				{
					"404": jsonError(
						"No subgraph, table, or row with that name or id (`SUBGRAPH_NOT_FOUND`, `TABLE_NOT_FOUND`, `ROW_NOT_FOUND`)",
					),
				},
			),
		},
	},
};

// ── Schemas ─────────────────────────────────────────────────────────────

const SUBGRAPH_TIP = {
	type: "object",
	description: "How far this subgraph has indexed, against the chain tip.",
	required: ["block_height", "subgraph_height", "blocks_behind"],
	properties: {
		block_height: {
			type: "integer",
			description: "Highest Stacks block this instance has indexed.",
		},
		subgraph_height: {
			type: "integer",
			description: "Last block this subgraph processed.",
		},
		blocks_behind: {
			type: "integer",
			minimum: 0,
			description: "`block_height` minus `subgraph_height`, never below 0.",
		},
	},
	example: EXAMPLE_TIP,
};

const EXAMPLE_SUMMARY = {
	name: EXAMPLE_NAME,
	description: null,
	status: "active",
	visibility: "private",
	owned: false,
	version: "1.0.0",
	created_at: EXAMPLE_DETAIL.createdAt,
	total_rows: EXAMPLE_ROWS,
	sources: ["SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token"],
	last_processed_block: EXAMPLE_TIP.subgraph_height,
	blocks_behind: 0,
	tables: [EXAMPLE_TABLE],
	url: `/v1/subgraphs/${EXAMPLE_NAME}`,
};

const STATUS_DESCRIPTION =
	"Indexing state: `active` (following the chain), `reindexing`, `paused`, or `error`.";
const VISIBILITY = {
	type: "string",
	enum: ["public", "private"],
	description:
		"Who can read it on hosted `api.secondlayer.tools`: `public` is open to anyone, `private` needs the owning account's key. Self-hosted instances ignore it; the bind decides.",
};
const SOURCES_DESCRIPTION =
	"Contracts the definition reads from: each source's `contractId`, and the contract half of each `assetIdentifier`.";

/** Resource schemas for these responses, merged into `components.schemas`. */
export const subgraphsSchemas = {
	SubgraphRow: {
		type: "object",
		description:
			"One row of a subgraph table. Every table has the four system columns below; the definition's own columns follow, each as its JSON type: `uint` and `int` (Postgres NUMERIC) as decimal strings, so values past 2^53 stay exact; `text` and `principal` as strings; `boolean` as a boolean; `timestamp` as an ISO 8601 string; `jsonb` as JSON. A `nullable` column can be `null`. `_fields` narrows the set.",
		required: ["_id", "_block_height", "_tx_id", "_created_at"],
		properties: {
			_id: {
				type: "string",
				pattern: "^[0-9]+$",
				description:
					"Row id, increasing in insert order. A string: Postgres BIGINT. The default page order and cursor.",
			},
			_block_height: {
				type: "string",
				pattern: "^[0-9]+$",
				description:
					"Stacks block the row was written at. A string: Postgres BIGINT.",
			},
			_tx_id: {
				type: "string",
				description: "Transaction whose event produced the row.",
			},
			_created_at: {
				type: "string",
				format: "date-time",
				description: "When the indexer wrote the row, not the block time.",
			},
		},
		additionalProperties: true,
		example: EXAMPLE_ROW,
	},
	SubgraphTip: SUBGRAPH_TIP,
	SubgraphRowsPage: {
		type: "object",
		description: "One page of rows from `GET /v1/subgraphs/{name}/{table}`.",
		required: ["rows", "next_cursor", "tip"],
		properties: {
			rows: {
				type: "array",
				description: "The page, in `_id` order or `_sort` order.",
				items: { $ref: "#/components/schemas/SubgraphRow" },
			},
			next_cursor: {
				type: ["string", "null"],
				description:
					"Pass back as `cursor` for the next page. Set on every full page, so the page after the last full one can be empty. `null` on a short page, which means you are at the end. Without `_sort` it is the last row's `_id`; with `_sort` it is an opaque token.",
			},
			tip: { $ref: "#/components/schemas/SubgraphTip" },
		},
		example: { rows: [EXAMPLE_ROW], next_cursor: "48138", tip: EXAMPLE_TIP },
	},
	SubgraphRowCount: {
		type: "object",
		required: ["count"],
		properties: {
			count: {
				type: "integer",
				description:
					"Rows matching the filters, or the planner's estimate for an unfiltered `_count=estimate`.",
			},
		},
		example: { count: EXAMPLE_ROWS },
	},
	SubgraphAggregates: {
		type: "object",
		description:
			"Only the aggregates you asked for are present. Sums, minimums and maximums are strings so large values stay exact.",
		properties: {
			count: {
				type: "integer",
				description:
					"Rows matching the filters. Present with `_count`, or when no other aggregate was asked for.",
			},
			countDistinct: {
				type: "object",
				additionalProperties: { type: "integer" },
				description: "Distinct values per `_countDistinct` column.",
			},
			sum: {
				type: "object",
				additionalProperties: { type: "string" },
				description: 'Sum per `_sum` column. `"0"` over no rows.',
			},
			min: {
				type: "object",
				additionalProperties: { type: ["string", "null"] },
				description: "Minimum per `_min` column. `null` over no rows.",
			},
			max: {
				type: "object",
				additionalProperties: { type: ["string", "null"] },
				description: "Maximum per `_max` column. `null` over no rows.",
			},
		},
		// `?_tx_id=<EXAMPLE_ROW._tx_id>&_count=true&_countDistinct=sender&_sum=amount&_max=amount`:
		// that transaction moved 14000 sats of sBTC through three hops.
		example: {
			count: 3,
			countDistinct: { sender: 3 },
			sum: { amount: "42000" },
			max: { amount: "14000" },
		},
	},
	SubgraphSummary: {
		type: "object",
		description: "One entry in the subgraph directory.",
		properties: {
			name: { type: "string", description: "Subgraph name." },
			description: {
				type: ["string", "null"],
				description: "The definition's `description`, if it has one.",
			},
			status: { type: "string", description: STATUS_DESCRIPTION },
			visibility: VISIBILITY,
			owned: {
				type: "boolean",
				description:
					"Hosted: whether your account key owns it. Always `false` self-hosted.",
			},
			version: { type: "string", description: "Deployed version." },
			created_at: {
				type: "string",
				format: "date-time",
				description: "First deploy.",
			},
			total_rows: {
				type: "integer",
				description:
					"Approximate rows across all its tables, from Postgres statistics. Use `/count` for an exact figure.",
			},
			sources: {
				type: "array",
				items: { type: "string" },
				description: SOURCES_DESCRIPTION,
			},
			last_processed_block: {
				type: "integer",
				description: "Last block it processed.",
			},
			blocks_behind: {
				type: "integer",
				description: "Chain tip minus `last_processed_block`, never below 0.",
			},
			tables: {
				type: "array",
				items: { type: "string" },
				description: "Its table names.",
			},
			url: { type: "string", description: "Its metadata endpoint." },
		},
		example: EXAMPLE_SUMMARY,
	},
	SubgraphDirectory: {
		type: "object",
		required: ["subgraphs", "tip", "envelope"],
		properties: {
			subgraphs: {
				type: "array",
				description: "Every subgraph you can read. Not paginated.",
				items: { $ref: "#/components/schemas/SubgraphSummary" },
			},
			tip: {
				type: "object",
				description: "The chain tip this list was read against.",
				properties: {
					block_height: {
						type: "integer",
						description: "Highest Stacks block this instance has indexed.",
					},
				},
			},
			envelope: {
				type: "object",
				description:
					"Fixed reminder of the row-read shape and cursor rules, for agents reading the directory cold.",
				properties: {
					rows: { type: "string", description: "The row route and envelope." },
					cursor: { type: "string", description: "How pagination works." },
				},
			},
		},
		example: {
			subgraphs: [EXAMPLE_SUMMARY],
			tip: { block_height: EXAMPLE_TIP.block_height },
			envelope: {
				rows: "GET /v1/subgraphs/:name/:table → { rows, next_cursor, tip }",
				cursor:
					"_id keyset by default, or ?_sort=<column>&_order=asc|desc for a composite keyset; pass ?cursor=<next_cursor> to resume",
			},
		},
	},
	Subgraph: {
		type: "object",
		description: "Metadata for one subgraph.",
		properties: {
			name: { type: "string", description: "Subgraph name." },
			description: {
				type: ["string", "null"],
				description: "The definition's `description`, if it has one.",
			},
			version: { type: "string", description: "Deployed version." },
			status: { type: "string", description: STATUS_DESCRIPTION },
			visibility: VISIBILITY,
			created_at: {
				type: "string",
				format: "date-time",
				description: "First deploy.",
			},
			sources: {
				type: "array",
				items: { type: "string" },
				description: SOURCES_DESCRIPTION,
			},
			start_block: {
				type: "integer",
				description: "Block indexing starts from. 0 means genesis.",
			},
			tables: {
				type: "object",
				description: "Each table by name.",
				additionalProperties: {
					type: "object",
					properties: {
						endpoint: { type: "string", description: "Its row endpoint." },
						columns: {
							type: "array",
							items: { type: "string" },
							description: "The definition's columns, without system columns.",
						},
						column_types: {
							type: "object",
							description: "Each column's declared type.",
							additionalProperties: {
								type: "string",
								enum: Object.keys(TYPE_MAP),
							},
						},
					},
				},
			},
			tip: { $ref: "#/components/schemas/SubgraphTip" },
			docs: {
				type: "object",
				description: "Generated docs for this subgraph.",
				properties: {
					openapi: { type: "string", description: "OpenAPI document." },
					schema: { type: "string", description: "Agent schema." },
					markdown: { type: "string", description: "Markdown docs." },
				},
			},
		},
		example: {
			name: EXAMPLE_NAME,
			description: null,
			version: "1.0.0",
			status: "active",
			visibility: "private",
			created_at: EXAMPLE_DETAIL.createdAt,
			sources: EXAMPLE_SUMMARY.sources,
			start_block: 0,
			tables: {
				[EXAMPLE_TABLE]: {
					endpoint: `/v1/subgraphs/${EXAMPLE_NAME}/${EXAMPLE_TABLE}`,
					columns: Object.keys(EXAMPLE_COLUMNS),
					column_types: Object.fromEntries(
						Object.entries(EXAMPLE_COLUMNS).map(([n, c]) => [n, c.type]),
					),
				},
			},
			tip: EXAMPLE_TIP,
			docs: {
				openapi: `/v1/subgraphs/${EXAMPLE_NAME}/openapi.json`,
				schema: `/v1/subgraphs/${EXAMPLE_NAME}/schema.json`,
				markdown: `/v1/subgraphs/${EXAMPLE_NAME}/docs.md`,
			},
		},
	},
	SubgraphOpenApiDocument: {
		type: "object",
		description: "OpenAPI 3.1 document generated from the definition.",
		properties: {
			openapi: { type: "string", description: "Always `3.1.0`." },
			info: {
				type: "object",
				description: "Title, the subgraph's version, and its description.",
			},
			servers: {
				type: "array",
				items: { type: "object" },
				description: "The `server` param, or this request's origin.",
			},
			paths: {
				type: "object",
				description: "A list path and a count path per table.",
			},
			components: {
				type: "object",
				description: "A `<table>Row` schema per table.",
			},
			"x-secondlayer-subgraph": {
				type: "string",
				description: "Subgraph name.",
			},
			"x-secondlayer-version": {
				type: "string",
				description: "Deployed version.",
			},
			"x-secondlayer-schema-hash": {
				type: "string",
				description:
					"sha256 of the definition's name, schema and sources. Changes only when they do.",
			},
			"x-secondlayer-generated-at": {
				type: "string",
				format: "date-time",
				description: "When this document was generated.",
			},
			"x-secondlayer-sources": {
				type: "object",
				description: "The definition's `sources`, as written.",
			},
			"x-secondlayer-tables": {
				type: "array",
				items: { type: "string" },
				description: "Table names.",
			},
		},
		example: generateSubgraphOpenApi(EXAMPLE_DETAIL, EXAMPLE_SPEC_OPTIONS),
	},
	SubgraphAgentSchema: {
		type: "object",
		description: "Compact description of a subgraph for agents and tools.",
		properties: {
			name: { type: "string", description: "Subgraph name." },
			version: { type: "string", description: "Deployed version." },
			description: {
				type: "string",
				description: "The definition's `description`. Absent without one.",
			},
			schemaHash: {
				type: "string",
				description: "sha256 of the definition's name, schema and sources.",
			},
			generatedAt: {
				type: "string",
				format: "date-time",
				description: "When this schema was generated.",
			},
			serverUrl: {
				type: "string",
				description: "The `server` param, or this request's origin.",
			},
			sources: {
				type: "object",
				description: "The definition's `sources`, as written.",
			},
			tables: {
				type: "object",
				description:
					"Per table: absolute endpoints, exact `rowCount`, columns including system columns, accepted `query` params and filters, and example requests.",
			},
		},
		example: generateSubgraphAgentSchema(EXAMPLE_DETAIL, EXAMPLE_SPEC_OPTIONS),
	},
};
