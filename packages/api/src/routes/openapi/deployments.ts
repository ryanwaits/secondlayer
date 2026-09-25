import type {
	SubgraphOperationKind,
	SubgraphOperationStatus,
} from "@secondlayer/shared/db";
import type {
	DeploySubgraphResponse,
	SubgraphSyncInfo,
} from "@secondlayer/shared/schemas/subgraphs";
import { MAX_LIMIT } from "../subgraph-query-helpers.ts";
import {
	WRITE_SECURITY,
	apiReadResponses,
	jsonBody,
	jsonError,
	pp,
	qp,
	writeResponses,
} from "./shared.ts";

/**
 * Every member of the string union `T`, checked by tsc in both directions: a
 * listed value outside `T` fails, and so does a member of `T` left out. Used
 * where the closed set exists only as a TypeScript union, not a runtime
 * constant, so the spec's `enum` cannot drift from the type.
 */
function allOf<T extends string>() {
	return <const A extends readonly T[]>(
		values: A & ([T] extends [A[number]] ? unknown : never),
	): A => values;
}

/** `SubgraphOperationKind`, `shared/src/db/types.ts`. */
const OPERATION_KINDS = allOf<SubgraphOperationKind>()(["reindex", "backfill"]);
/** `SubgraphOperationStatus`, `shared/src/db/types.ts`. */
const OPERATION_STATUSES = allOf<SubgraphOperationStatus>()([
	"queued",
	"running",
	"completed",
	"failed",
	"cancelled",
]);
/** `DeploySubgraphResponse["action"]`, `shared/src/schemas/subgraphs.ts`. */
const DEPLOY_ACTIONS = allOf<DeploySubgraphResponse["action"]>()([
	"created",
	"unchanged",
	"handler_updated",
	"updated",
	"reindexed",
]);
/** `SubgraphSyncInfo["status"]`, `shared/src/schemas/subgraphs.ts`. */
const SYNC_STATUSES = allOf<SubgraphSyncInfo["status"]>()([
	"synced",
	"catching_up",
	"reindexing",
	"error",
]);
/** `SubgraphSyncInfo["integrity"]`, `shared/src/schemas/subgraphs.ts`. */
const INTEGRITY_STATES = allOf<SubgraphSyncInfo["integrity"]>()([
	"complete",
	"gaps_detected",
	"history_filling",
]);
/** `weight` in `createSubgraphOperation`,
 *  `shared/src/db/queries/subgraph-operations.ts`. */
const OPERATION_WEIGHTS = ["light", "heavy"] as const;
/**
 * `subgraphs.status` is a bare `text` column. These are the only values any
 * writer sets: `shared/src/db/queries/subgraphs.ts` (`active`, `paused`,
 * `error`) and the reindex runtime (`reindexing`).
 */
const SUBGRAPH_STATUSES = ["active", "reindexing", "paused", "error"] as const;
/** The only gap reasons the runtime records: `subgraphs/src/runtime/reindex.ts`
 *  and `block-processor.ts`. `subgraph_gaps.reason` is bare `text`. */
const GAP_REASONS = ["block_missing", "processing_error"] as const;

const NAME_PARAM = pp(
	"name",
	"Subgraph name, as deployed. Lowercase letters, digits and hyphens.",
);
const OPERATION_ID_PARAM = pp(
	"operation_id",
	"Operation id (UUID) from a deploy, reindex or backfill response, or from the operations list.",
);

const NOT_FOUND_SUBGRAPH = jsonError(
	"No subgraph by this name on this instance (`SUBGRAPH_NOT_FOUND`)",
);
const OPERATION_IN_PROGRESS = jsonError(
	"A reindex or backfill is already queued or running for this subgraph (`OPERATION_IN_PROGRESS`). Wait for it, or stop it first.",
);

function ok200(ref: string, description: string) {
	return {
		description,
		content: {
			"application/json": { schema: { $ref: `#/components/schemas/${ref}` } },
		},
	};
}

// Worked example: the `sbtc-flows` subgraph from /docs/subgraphs, deployed
// at block 8,000,000 on an instance whose tip is 9,048,712.
const EXAMPLE_TIP = 9048712;
const EXAMPLE_SOURCES = {
	transfers: {
		type: "ft_transfer",
		assetIdentifier:
			"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
	},
};
const EXAMPLE_SCHEMA = {
	transfers: {
		columns: {
			amount: { type: "uint" },
			sender: { type: "principal" },
			recipient: { type: "principal" },
		},
	},
};
const EXAMPLE_SOURCE_CODE = `import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "sbtc-flows",
  startBlock: 8000000,
  sources: {
    transfers: {
      type: "ft_transfer",
      assetIdentifier: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
    },
  },
  schema: {
    transfers: {
      columns: {
        amount: { type: "uint" },
        sender: { type: "principal" },
        recipient: { type: "principal" },
      },
    },
  },
  handlers: {
    transfers: (event, ctx) => {
      ctx.insert("transfers", { amount: event.amount, sender: event.sender, recipient: event.recipient });
    },
  },
});
`;
/** What `/bundle` returns for `EXAMPLE_SOURCE_CODE` (724 bytes). */
const EXAMPLE_HANDLER_CODE = `// secondlayer-stub:@secondlayer/subgraphs
function defineSubgraph(def) {
  return def;
}

// <stdin>
var stdin_default = defineSubgraph({
  name: "sbtc-flows",
  startBlock: 8e6,
  sources: {
    transfers: {
      type: "ft_transfer",
      assetIdentifier: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token"
    }
  },
  schema: {
    transfers: {
      columns: {
        amount: { type: "uint" },
        sender: { type: "principal" },
        recipient: { type: "principal" }
      }
    }
  },
  handlers: {
    transfers: (event, ctx) => {
      ctx.insert("transfers", { amount: event.amount, sender: event.sender, recipient: event.recipient });
    }
  }
});
export {
  stdin_default as default
};
`;
const EXAMPLE_OPERATION_ID = "3f1c9a52-7d4e-4b8a-9e21-5c0d8f6a2b17";

export const deploymentsPaths = {
	"/api/subgraphs": {
		get: {
			tags: ["deployments"],
			summary: "List deployed subgraphs",
			description:
				"Every subgraph on this instance with its status, sync progress, row count and open gap count. Row counts come from Postgres table statistics, so they are approximate; the detail read counts exactly.",
			security: WRITE_SECURITY,
			responses: apiReadResponses({
				"200": {
					description: "Every deployed subgraph, unpaginated",
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["data"],
								properties: {
									data: {
										type: "array",
										description: "One entry per deployed subgraph.",
										items: { $ref: "#/components/schemas/DeployedSubgraph" },
									},
								},
								example: {
									data: [
										{
											name: "sbtc-flows",
											version: "1.0.2",
											status: "active",
											lastProcessedBlock: EXAMPLE_TIP,
											totalProcessed: 48210,
											totalRows: 48138,
											totalErrors: 0,
											tables: ["transfers"],
											chainTip: EXAMPLE_TIP,
											sourceChainTip: EXAMPLE_TIP,
											targetBlock: EXAMPLE_TIP,
											progress: 1,
											blocksRemaining: 0,
											syncMode: "sync",
											gapCount: 0,
											integrity: "complete",
											lastError: null,
											lastErrorAt: null,
											updatedAt: "2026-09-23T14:02:11.000Z",
											webhookCount: 1,
											createdAt: "2026-09-21T09:14:52.000Z",
										},
									],
								},
							},
						},
					},
				},
			}),
		},
		post: {
			tags: ["deployments"],
			summary: "Deploy or redeploy a subgraph",
			description:
				"Takes bundled handler code (see `/api/subgraphs/bundle`) plus the schema and sources extracted from it. The server reads the definition from the bundle without running it, validates it, lints print fields, then applies the schema. A new subgraph, or a breaking schema change, queues a reindex and returns its `operationId`. Redeploying the same name updates in place; `action` says what happened. With `dryRun` it returns the DDL plan and writes nothing.",
			security: WRITE_SECURITY,
			requestBody: jsonBody({
				$ref: "#/components/schemas/DeploySubgraphRequest",
			}),
			responses: writeResponses({
				"200": {
					description:
						"Redeployed in place (`action` is anything but `created`), or the dry-run plan when `dryRun` is set",
					content: {
						"application/json": {
							schema: {
								oneOf: [
									{ $ref: "#/components/schemas/DeployResult" },
									{ $ref: "#/components/schemas/DeployDryRun" },
								],
								example: {
									action: "handler_updated",
									subgraphId: "b7e2d4a1-5c3f-4e8b-a0d9-2f6c1e8b7a34",
									version: "1.0.3",
									start_block: 8000000,
									message: 'Subgraph "sbtc-flows" handler_updated',
									warnings: [
										"handler changed but schema did not: new logic applies from the current tip only. Rows already indexed were computed by the previous handler. To recompute history, redeploy with --reindex (or backfill a range).",
									],
								},
							},
						},
					},
				},
				"201": ok200(
					"DeployResult",
					"Created. A reindex from `start_block` is queued; poll `operationId`",
				),
				"400": jsonError(
					"The body failed validation (here `error` is an object of field errors, not a string), the bundle could not be read (`HANDLER_IMPORT_FAILED`), the definition is invalid, or `startBlock` is past the chain tip (`START_BLOCK_PAST_TIP`)",
				),
				"409": OPERATION_IN_PROGRESS,
				"422": jsonError(
					"The definition deploys but would index wrong: a declared print field is never seen on-chain (`PRINT_FIELD_MISMATCH`), handlers write 0 rows against observed prints (`EMPTY_MAPPING`), or a tip-first deploy has delta handlers (`TIP_FIRST_NON_REPLAYABLE_HANDLER`) or a breaking schema change (`TIP_FIRST_BREAKING_CHANGE`)",
				),
			}),
		},
	},
	"/api/subgraphs/bundle": {
		post: {
			tags: ["deployments"],
			summary: "Bundle subgraph source into deployable handler code",
			description:
				"Compiles a TypeScript subgraph module on the server and returns the bundle plus the metadata read from it, ready to POST to `/api/subgraphs`. Deploys nothing. The CLI and MCP bundle locally; this is for callers that cannot run esbuild.",
			security: WRITE_SECURITY,
			requestBody: jsonBody({
				type: "object",
				required: ["code"],
				properties: {
					code: {
						type: "string",
						description:
							"The subgraph module's TypeScript source, with `defineSubgraph` as the default export.",
					},
				},
				example: { code: EXAMPLE_SOURCE_CODE },
			}),
			responses: writeResponses({
				"200": ok200("SubgraphBundle", "Bundled"),
				"400": jsonError(
					"`code` is missing or empty, or the module did not compile (`BUNDLE_FAILED`)",
				),
				"413": jsonError(
					"The bundle exceeds the size limit (`BUNDLE_TOO_LARGE`); `actualBytes` and `maxBytes` say by how much",
				),
			}),
		},
	},
	"/api/subgraphs/{name}": {
		get: {
			tags: ["deployments"],
			summary: "Get a deployed subgraph",
			description:
				"Definition, health, sync progress and per-table columns and exact row counts. While a reindex or backfill is active, `sync` carries its queue position, event progress and ETA.",
			security: WRITE_SECURITY,
			parameters: [NAME_PARAM],
			responses: apiReadResponses({
				"200": ok200("DeployedSubgraphDetail", "The subgraph"),
				"404": NOT_FOUND_SUBGRAPH,
			}),
		},
		delete: {
			tags: ["deployments"],
			summary: "Delete a subgraph",
			description:
				"Requests cancellation of any queued or running operation, waits up to 30 seconds for the processor to release it, then drops the Postgres schema and the registry row. Irreversible.",
			security: WRITE_SECURITY,
			parameters: [
				NAME_PARAM,
				qp(
					"force",
					"boolean",
					false,
					"Accepted and logged. The delete proceeds after the 30-second wait either way.",
				),
			],
			responses: writeResponses({
				"200": {
					description: "Deleted",
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["message"],
								properties: {
									message: {
										type: "string",
										description: "Confirmation naming the subgraph.",
									},
								},
								example: { message: 'Subgraph "sbtc-flows" deleted' },
							},
						},
					},
				},
				"404": NOT_FOUND_SUBGRAPH,
			}),
		},
	},
	"/api/subgraphs/{name}/reindex": {
		post: {
			tags: ["deployments"],
			summary: "Queue a full reindex",
			description:
				"Drops the subgraph's tables and rebuilds them from its start block to the chain tip. Takes no body. A `fromBlock`/`toBlock` is refused with 400 `REINDEX_RANGE_NOT_SUPPORTED` rather than ignored, since a ranged walk would destroy everything outside the range; use `backfill` for a range. Poll the returned `operationId`.",
			security: WRITE_SECURITY,
			parameters: [NAME_PARAM],
			responses: writeResponses({
				"200": {
					description: "Reindex queued",
					content: {
						"application/json": {
							schema: {
								$ref: "#/components/schemas/SubgraphOperationQueued",
							},
							example: {
								message: 'Reindex queued for subgraph "sbtc-flows"',
								fromBlock: 8000000,
								toBlock: "chain tip",
								operationId: EXAMPLE_OPERATION_ID,
								status: "queued",
							},
						},
					},
				},
				"400": jsonError(
					"The body carried `fromBlock` or `toBlock` (`REINDEX_RANGE_NOT_SUPPORTED`)",
				),
				"404": NOT_FOUND_SUBGRAPH,
				"409": OPERATION_IN_PROGRESS,
			}),
		},
	},
	"/api/subgraphs/{name}/backfill": {
		post: {
			tags: ["deployments"],
			summary: "Queue a backfill over a block range",
			description:
				"Re-runs handlers over `fromBlock` to `toBlock`, inclusive, without dropping data. A backfill that overlaps an earlier failed or cancelled one resumes from its last committed block. Refused when the handlers apply deltas (`ctx.increment`, `ctx.update`) or read-modify-write rows (`ctx.findOne`, `ctx.findMany`), which would double-count blocks already processed; reindex those instead.",
			security: WRITE_SECURITY,
			parameters: [NAME_PARAM],
			requestBody: jsonBody({
				type: "object",
				required: ["fromBlock", "toBlock"],
				properties: {
					fromBlock: {
						type: "integer",
						minimum: 1,
						description: "First block height to re-run, inclusive.",
					},
					toBlock: {
						type: "integer",
						minimum: 1,
						description: "Last block height to re-run, inclusive.",
					},
				},
				example: { fromBlock: 8950000, toBlock: 9000000 },
			}),
			responses: writeResponses({
				"200": {
					description: "Backfill queued",
					content: {
						"application/json": {
							schema: {
								$ref: "#/components/schemas/SubgraphOperationQueued",
							},
							example: {
								message: 'Backfill queued for subgraph "sbtc-flows"',
								fromBlock: 8950000,
								toBlock: 9000000,
								operationId: "9a4e7c21-0b3d-4f6a-8c15-e2d7b9f0a461",
								status: "queued",
							},
						},
					},
				},
				"400": jsonError(
					"`fromBlock` or `toBlock` is missing, not a number, or 0 (`VALIDATION_ERROR`)",
				),
				"404": NOT_FOUND_SUBGRAPH,
				"409": OPERATION_IN_PROGRESS,
				"422": jsonError(
					"The handlers apply deltas and cannot be replayed (`BACKFILL_NON_REPLAYABLE_HANDLER`)",
				),
			}),
		},
	},
	"/api/subgraphs/{name}/stop": {
		post: {
			tags: ["deployments"],
			summary: "Stop the active reindex or backfill",
			description:
				"Takes no body. Flags the queued or running operation for cancellation; the processor stops it at its next checkpoint and marks it `cancelled`. A stopped backfill resumes from its checkpoint when the same range is queued again.",
			security: WRITE_SECURITY,
			parameters: [NAME_PARAM],
			responses: writeResponses({
				"200": {
					description: "Stop requested",
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["message", "operationId", "status"],
								properties: {
									message: {
										type: "string",
										description: "Confirmation naming the subgraph.",
									},
									operationId: {
										type: "string",
										format: "uuid",
										description: "The operation being stopped.",
									},
									status: {
										type: "string",
										enum: ["cancel_requested"],
										description:
											"Always `cancel_requested`. Poll the operation until its status is `cancelled`.",
									},
								},
								example: {
									message: 'Stop requested for "sbtc-flows"',
									operationId: EXAMPLE_OPERATION_ID,
									status: "cancel_requested",
								},
							},
						},
					},
				},
				"404": jsonError(
					"No subgraph by this name (`SUBGRAPH_NOT_FOUND`), or nothing queued or running to stop (`NO_OPERATION`)",
				),
			}),
		},
	},
	"/api/subgraphs/{name}/operations": {
		get: {
			tags: ["deployments"],
			summary: "List a subgraph's operations",
			description:
				"The 20 most recent reindex and backfill operations, newest first, with progress. Queued ones carry an approximate `queuePosition`.",
			security: WRITE_SECURITY,
			parameters: [NAME_PARAM],
			responses: apiReadResponses({
				"200": {
					description: "Recent operations",
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["operations"],
								properties: {
									operations: {
										type: "array",
										description: "Newest first, at most 20.",
										items: {
											$ref: "#/components/schemas/SubgraphOperation",
										},
									},
								},
							},
						},
					},
				},
				"404": NOT_FOUND_SUBGRAPH,
			}),
		},
	},
	"/api/subgraphs/{name}/operations/{operation_id}": {
		get: {
			tags: ["deployments"],
			summary: "Get an operation",
			description:
				"One reindex or backfill by id. Poll it after a deploy, reindex or backfill until `status` is `completed`, `failed` or `cancelled`.",
			security: WRITE_SECURITY,
			parameters: [NAME_PARAM, OPERATION_ID_PARAM],
			responses: apiReadResponses({
				"200": ok200("SubgraphOperation", "The operation"),
				"404": jsonError(
					"No subgraph by this name (`SUBGRAPH_NOT_FOUND`), or no operation with this id on it (`OPERATION_NOT_FOUND`)",
				),
			}),
		},
	},
	"/api/subgraphs/{name}/gaps": {
		get: {
			tags: ["deployments"],
			summary: "List a subgraph's gaps",
			description:
				"Block ranges the subgraph failed to process, ordered by start height. Open gaps only by default.",
			security: WRITE_SECURITY,
			parameters: [
				NAME_PARAM,
				qp(
					"_limit",
					"integer",
					false,
					`Page size, 1 to ${MAX_LIMIT}. Default 50.`,
				),
				qp("_offset", "integer", false, "Gaps to skip. Default 0."),
				{
					...qp(
						"resolved",
						"string",
						false,
						"`true` or `all` include resolved gaps with the open ones. Omit for open gaps only.",
					),
					schema: { type: "string", enum: ["true", "all"] },
				},
			],
			responses: apiReadResponses({
				"200": {
					description: "A page of gaps",
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["data", "meta"],
								properties: {
									data: {
										type: "array",
										description: "Gaps on this page.",
										items: { $ref: "#/components/schemas/SubgraphGap" },
									},
									meta: {
										type: "object",
										description:
											"`total` gaps matching the filter, `totalMissingBlocks` across open gaps, and the `limit` and `offset` applied.",
										properties: {
											total: { type: "integer" },
											totalMissingBlocks: { type: "integer" },
											limit: { type: "integer" },
											offset: { type: "integer" },
										},
									},
								},
								example: {
									data: [
										{
											start: 8412207,
											end: 8412207,
											size: 1,
											reason: "processing_error",
											detectedAt: "2026-09-22T18:40:03.000Z",
											resolvedAt: null,
										},
									],
									meta: {
										total: 1,
										totalMissingBlocks: 1,
										limit: 50,
										offset: 0,
									},
								},
							},
						},
					},
				},
				"404": NOT_FOUND_SUBGRAPH,
			}),
		},
	},
	"/api/subgraphs/{name}/violations": {
		get: {
			tags: ["deployments"],
			summary: "List a subgraph's print violations",
			description:
				"Print events a handler skipped because the payload did not match the source's declared `prints` schema, newest first. The instance keeps the last 100 per subgraph.",
			security: WRITE_SECURITY,
			parameters: [
				NAME_PARAM,
				qp("limit", "integer", false, "Page size, 1 to 100. Default 50."),
			],
			responses: apiReadResponses({
				"200": {
					description: "Recent violations",
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["data", "meta"],
								properties: {
									data: {
										type: "array",
										description: "Newest first.",
										items: { $ref: "#/components/schemas/SubgraphViolation" },
									},
									meta: {
										type: "object",
										description:
											"`total` violations kept for this subgraph (at most 100) and the `limit` applied.",
										properties: {
											total: { type: "integer" },
											limit: { type: "integer" },
										},
									},
								},
								example: {
									data: [
										{
											id: "c41d8e27-6f0a-4b93-a5e2-7d19b3c8f056",
											sourceName: "swaps",
											blockHeight: 9031477,
											txId: "0x8d2f6a91c4e07b35d1a8f2e69c0b47d3a5e18f62b9c04d7e3a16f58b2c9d0e41",
											reason: 'missing declared field "amount-in"',
											samplePayload: {
												topic: "swap",
												data: {
													"amount-out": "1500000",
													sender: "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9",
												},
											},
											seenAt: "2026-09-23T11:27:45.000Z",
										},
									],
									meta: { total: 1, limit: 50 },
								},
							},
						},
					},
				},
				"404": NOT_FOUND_SUBGRAPH,
			}),
		},
	},
};

const SYNC_EXAMPLE = {
	status: "synced",
	mode: "sync",
	startBlock: 8000000,
	lastProcessedBlock: EXAMPLE_TIP,
	chainTip: EXAMPLE_TIP,
	sourceChainTip: EXAMPLE_TIP,
	targetBlock: EXAMPLE_TIP,
	blocksRemaining: 0,
	processedBlocks: 1048713,
	totalBlocks: 1048713,
	progress: 1,
	gaps: { count: 0, totalMissingBlocks: 0, ranges: [] },
	integrity: "complete",
};

/** Resource schemas for these responses, merged into `components.schemas`. */
export const deploymentsSchemas = {
	DeploySubgraphRequest: {
		type: "object",
		description:
			"A bundled subgraph. `POST /api/subgraphs/bundle` returns every field but `startBlock` and `dryRun`.",
		required: ["name", "sources", "schema", "handlerCode"],
		properties: {
			name: {
				type: "string",
				maxLength: 63,
				pattern: "^[a-z0-9-]+$",
				description:
					"Subgraph name. Lowercase letters, digits and hyphens. Deploying an existing name updates it.",
			},
			sources: {
				type: "object",
				description:
					"Event sources keyed by name, as read from the handler module. At least one.",
			},
			schema: {
				type: "object",
				description: "Table definitions keyed by table name.",
			},
			handlerCode: {
				type: "string",
				maxLength: 1048576,
				description: "The bundled handler module. 1 MB max.",
			},
			startBlock: {
				type: "integer",
				minimum: 0,
				description:
					"Overrides the definition's `startBlock` for this deploy and forces a reindex from it. Refused past the chain tip (`START_BLOCK_PAST_TIP`).",
			},
			description: {
				type: "string",
				description: "One line on what the subgraph indexes.",
			},
			sourceCode: {
				type: "string",
				maxLength: 1048576,
				description:
					"The unbundled TypeScript source, kept so `secondlayer subgraphs source` can return it. 1 MB max.",
			},
			dryRun: {
				type: "boolean",
				description:
					"Validate and return the DDL plan without writing anything.",
			},
		},
		example: {
			name: "sbtc-flows",
			sources: EXAMPLE_SOURCES,
			schema: EXAMPLE_SCHEMA,
			handlerCode: EXAMPLE_HANDLER_CODE,
			sourceCode: EXAMPLE_SOURCE_CODE,
		},
	},
	DeployResult: {
		type: "object",
		description: "What a deploy did.",
		required: ["action", "subgraphId", "version", "message"],
		properties: {
			action: {
				type: "string",
				enum: [...DEPLOY_ACTIONS],
				description:
					"`created`: new subgraph, reindex queued. `unchanged`: same schema and handler. `handler_updated`: new handler, applies from the tip only. `updated`: additive schema change applied in place. `reindexed`: breaking change or forced start block, tables dropped and a reindex queued.",
			},
			subgraphId: {
				type: "string",
				format: "uuid",
				description: "Registry id.",
			},
			version: { type: "string", description: "Version now deployed." },
			start_block: {
				type: "integer",
				description: "Height indexing starts from.",
			},
			message: { type: "string", description: "One-line summary." },
			live_from: {
				type: "integer",
				description:
					"Tip-first deploys only: the height live indexing starts from, two blocks behind the tip.",
			},
			history: {
				type: "object",
				description:
					"Tip-first deploys only: the backfill filling history below `live_from`, as `from`, `to` and `operationId`.",
				properties: {
					from: { type: "integer" },
					to: { type: "integer" },
					operationId: { type: "string", format: "uuid" },
				},
			},
			warnings: {
				type: "array",
				items: { type: "string" },
				description:
					"Advisories that did not block the deploy, such as a handler reading a print field never seen on-chain.",
			},
			diff: {
				type: "object",
				description:
					"Schema diff against the previous deploy: `addedTables`, `removedTables`, `addedColumns` by table, `breakingChanges`, and when present `indexChanges` and `addedUniqueKeys`.",
			},
			reindexStarted: {
				type: "boolean",
				description: "`true` when the deploy queued a reindex or history fill.",
			},
			operationId: {
				type: "string",
				format: "uuid",
				description:
					"The queued operation. Poll `/api/subgraphs/{name}/operations/{operation_id}`.",
			},
			estimatedEvents: {
				type: "integer",
				description:
					"Events the queued operation expects to process. Only for contract-scoped sources; absent otherwise.",
			},
		},
		example: {
			action: "created",
			subgraphId: "b7e2d4a1-5c3f-4e8b-a0d9-2f6c1e8b7a34",
			version: "1.0.0",
			start_block: 8000000,
			message: 'Subgraph "sbtc-flows" created',
			reindexStarted: true,
			operationId: EXAMPLE_OPERATION_ID,
			estimatedEvents: 48210,
		},
	},
	DeployDryRun: {
		type: "object",
		description: "The DDL a deploy would run. Nothing was written.",
		required: ["dryRun", "schemaName", "statements"],
		properties: {
			dryRun: {
				type: "boolean",
				enum: [true],
				description: "Always `true`.",
			},
			schemaName: {
				type: "string",
				description: "Postgres schema the tables would live in.",
			},
			statements: {
				type: "array",
				items: { type: "string" },
				description: "SQL statements, in order.",
			},
			warnings: {
				type: "array",
				items: { type: "string" },
				description: "Print-field advisories, as on a real deploy.",
			},
		},
		example: {
			dryRun: true,
			schemaName: "subgraph_sbtc_flows",
			statements: [
				"CREATE SCHEMA IF NOT EXISTS subgraph_sbtc_flows",
				"CREATE TABLE IF NOT EXISTS subgraph_sbtc_flows.transfers (\n  _id BIGSERIAL PRIMARY KEY,\n  _block_height BIGINT NOT NULL,\n  _tx_id TEXT NOT NULL,\n  _created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  amount NUMERIC NOT NULL CHECK (amount >= 0),\n  sender TEXT NOT NULL,\n  recipient TEXT NOT NULL\n)",
				"CREATE INDEX IF NOT EXISTS idx_subgraph_sbtc_flows_transfers_block_height ON subgraph_sbtc_flows.transfers (_block_height)",
				"CREATE INDEX IF NOT EXISTS idx_subgraph_sbtc_flows_transfers_tx_id ON subgraph_sbtc_flows.transfers (_tx_id)",
			],
		},
	},
	SubgraphBundle: {
		type: "object",
		description:
			"A compiled subgraph. Everything but `ok` and `bundleSize` is the body for `POST /api/subgraphs`.",
		required: [
			"ok",
			"name",
			"sources",
			"schema",
			"handlerCode",
			"sourceCode",
			"bundleSize",
		],
		properties: {
			ok: { type: "boolean", enum: [true], description: "Always `true`." },
			name: { type: "string", description: "Name from the definition." },
			description: {
				type: ["string", "null"],
				description: "Description from the definition, if set.",
			},
			sources: { type: "object", description: "Event sources by name." },
			schema: { type: "object", description: "Table definitions by name." },
			handlerCode: {
				type: "string",
				description: "The bundled handler module.",
			},
			sourceCode: {
				type: "string",
				description: "The `code` you sent, echoed back.",
			},
			bundleSize: {
				type: "integer",
				description: "Size of `handlerCode` in bytes.",
			},
		},
		example: {
			ok: true,
			name: "sbtc-flows",
			description: null,
			sources: EXAMPLE_SOURCES,
			schema: EXAMPLE_SCHEMA,
			handlerCode: EXAMPLE_HANDLER_CODE,
			sourceCode: EXAMPLE_SOURCE_CODE,
			bundleSize: 724,
		},
	},
	DeployedSubgraph: {
		type: "object",
		description: "One deployed subgraph, as the list returns it.",
		required: [
			"name",
			"version",
			"status",
			"lastProcessedBlock",
			"totalProcessed",
			"totalErrors",
			"tables",
			"chainTip",
			"progress",
			"gapCount",
			"integrity",
			"createdAt",
		],
		properties: {
			name: { type: "string", description: "Subgraph name." },
			version: { type: "string", description: "Deployed version." },
			status: {
				type: "string",
				enum: [...SUBGRAPH_STATUSES],
				description: "Processor state.",
			},
			lastProcessedBlock: {
				type: "integer",
				description: "Highest block processed.",
			},
			totalProcessed: {
				type: "integer",
				description: "Events handled since deploy.",
			},
			totalRows: {
				type: "integer",
				description: "Approximate rows across tables, from table statistics.",
			},
			totalErrors: {
				type: "integer",
				description: "Handler errors since deploy.",
			},
			tables: {
				type: "array",
				items: { type: "string" },
				description: "Table names.",
			},
			chainTip: {
				type: "integer",
				description:
					"Progress denominator: the chain tip, or the reindex target while reindexing.",
			},
			sourceChainTip: {
				type: "integer",
				description: "The instance's chain tip.",
			},
			targetBlock: {
				type: "integer",
				description: "Height this sync or reindex is walking toward.",
			},
			progress: {
				type: "number",
				minimum: 0,
				maximum: 1,
				description: "Fraction of blocks processed, 0 to 1.",
			},
			blocksRemaining: {
				type: "integer",
				description: "Blocks left to `targetBlock`.",
			},
			syncMode: {
				type: "string",
				enum: ["sync", "reindex"],
				description: "`reindex` while a reindex walk runs.",
			},
			gapCount: { type: "integer", description: "Open gaps." },
			integrity: {
				type: "string",
				enum: ["complete", "gaps_detected"],
				description: "`gaps_detected` when any gap is open.",
			},
			lastError: {
				type: ["string", "null"],
				description: "Most recent processing error.",
			},
			lastErrorAt: {
				type: ["string", "null"],
				format: "date-time",
				description: "When it happened.",
			},
			updatedAt: {
				type: ["string", "null"],
				format: "date-time",
				description: "Last registry update.",
			},
			webhookCount: {
				type: "integer",
				description: "Webhooks attached to this subgraph.",
			},
			createdAt: {
				type: "string",
				format: "date-time",
				description: "First deploy.",
			},
		},
		example: {
			name: "sbtc-flows",
			version: "1.0.2",
			status: "active",
			lastProcessedBlock: EXAMPLE_TIP,
			totalProcessed: 48210,
			totalRows: 48138,
			totalErrors: 0,
			tables: ["transfers"],
			chainTip: EXAMPLE_TIP,
			sourceChainTip: EXAMPLE_TIP,
			targetBlock: EXAMPLE_TIP,
			progress: 1,
			blocksRemaining: 0,
			syncMode: "sync",
			gapCount: 0,
			integrity: "complete",
			lastError: null,
			lastErrorAt: null,
			updatedAt: "2026-09-23T14:02:11.000Z",
			webhookCount: 1,
			createdAt: "2026-09-21T09:14:52.000Z",
		},
	},
	DeployedSubgraphSync: {
		type: "object",
		description:
			"Sync progress. While an operation is queued, `queue` is set; while one runs, `estimatedEvents`, `processedEvents` and `etaSeconds` may be.",
		required: [
			"status",
			"startBlock",
			"lastProcessedBlock",
			"chainTip",
			"blocksRemaining",
			"progress",
			"gaps",
			"integrity",
		],
		properties: {
			status: {
				type: "string",
				enum: [...SYNC_STATUSES],
				description: "Sync state.",
			},
			mode: {
				type: "string",
				enum: ["sync", "reindex"],
				description: "`reindex` while a reindex walk runs.",
			},
			startBlock: {
				type: "integer",
				description: "Height the walk started from.",
			},
			lastProcessedBlock: {
				type: "integer",
				description: "Highest block processed.",
			},
			chainTip: {
				type: "integer",
				description:
					"Progress denominator: the chain tip, or the reindex target while reindexing.",
			},
			sourceChainTip: {
				type: "integer",
				description: "The instance's chain tip.",
			},
			targetBlock: {
				type: "integer",
				description: "Height the walk is heading to.",
			},
			blocksRemaining: {
				type: "integer",
				description: "Blocks left to `targetBlock`.",
			},
			processedBlocks: {
				type: "integer",
				description: "Blocks covered so far.",
			},
			totalBlocks: {
				type: "integer",
				description: "Blocks from `startBlock` to `targetBlock`.",
			},
			progress: {
				type: "number",
				minimum: 0,
				maximum: 1,
				description: "Fraction of blocks processed, 0 to 1.",
			},
			queue: {
				type: "object",
				description:
					"Queued operation only: approximate `position`, `estimatedEvents`, and `estimatedStartSeconds` from recent run times. Each may be null.",
				properties: {
					position: { type: ["integer", "null"] },
					estimatedEvents: { type: ["integer", "null"] },
					estimatedStartSeconds: { type: ["integer", "null"] },
				},
			},
			estimatedEvents: {
				type: "integer",
				description: "Running operation: events it expects to process.",
			},
			processedEvents: {
				type: "integer",
				description: "Running operation: events processed so far.",
			},
			etaSeconds: {
				type: ["integer", "null"],
				description:
					"Running operation: seconds left. `null` for its first 30 seconds.",
			},
			gaps: {
				type: "object",
				description:
					"Open gaps: `count`, `totalMissingBlocks`, and up to 10 `ranges`.",
				properties: {
					count: { type: "integer" },
					totalMissingBlocks: { type: "integer" },
					ranges: {
						type: "array",
						items: {
							type: "object",
							properties: {
								start: { type: "integer" },
								end: { type: "integer" },
								size: { type: "integer" },
								reason: { type: "string", enum: [...GAP_REASONS] },
							},
						},
					},
				},
			},
			integrity: {
				type: "string",
				enum: [...INTEGRITY_STATES],
				description:
					"`history_filling` while a tip-first history backfill runs, even with no gaps recorded.",
			},
		},
		example: SYNC_EXAMPLE,
	},
	DeployedSubgraphDetail: {
		type: "object",
		description: "One deployed subgraph in full.",
		required: [
			"name",
			"version",
			"status",
			"lastProcessedBlock",
			"health",
			"sync",
			"tables",
			"createdAt",
			"updatedAt",
		],
		properties: {
			name: { type: "string", description: "Subgraph name." },
			version: { type: "string", description: "Deployed version." },
			schemaHash: {
				type: "string",
				description: "Hash of the table schema. Changes when the schema does.",
			},
			status: {
				type: "string",
				enum: [...SUBGRAPH_STATUSES],
				description: "Processor state.",
			},
			lastProcessedBlock: {
				type: "integer",
				description: "Highest block processed.",
			},
			description: {
				type: "string",
				description: "From the definition, when set.",
			},
			sources: {
				type: "object",
				description: "Event sources by name, from the definition.",
			},
			definition: {
				type: ["object", "null"],
				description:
					"The stored definition: `name`, `description`, `startBlock`, `sources`, `schema`.",
			},
			health: {
				type: "object",
				description:
					"`totalProcessed` and `totalErrors` since deploy, `errorRate`, the last error and when, `emptyMapping` (events matched but every table is empty), and `violationCount` (print violations kept).",
				properties: {
					totalProcessed: { type: "integer" },
					totalErrors: { type: "integer" },
					errorRate: { type: "number" },
					lastError: { type: ["string", "null"] },
					lastErrorAt: { type: ["string", "null"], format: "date-time" },
					emptyMapping: { type: "boolean" },
					violationCount: { type: "integer" },
				},
			},
			sync: { $ref: "#/components/schemas/DeployedSubgraphSync" },
			tables: {
				type: "object",
				description:
					"By table name: read `endpoint`, `columns` (with the system columns `_id`, `_block_height`, `_tx_id`, `_created_at`), exact `rowCount`, an `example` query, and `indexes` and `uniqueKeys` when declared.",
			},
			createdAt: {
				type: "string",
				format: "date-time",
				description: "First deploy.",
			},
			updatedAt: {
				type: "string",
				format: "date-time",
				description: "Last registry update.",
			},
		},
		example: {
			name: "sbtc-flows",
			version: "1.0.2",
			schemaHash:
				"4b9e1d27c83f0a65e2d7b14c9f06a38e5d21c7b90f4e6a83d15c2b7e09f4a6d1",
			status: "active",
			lastProcessedBlock: EXAMPLE_TIP,
			sources: EXAMPLE_SOURCES,
			definition: {
				name: "sbtc-flows",
				startBlock: 8000000,
				sources: EXAMPLE_SOURCES,
				schema: EXAMPLE_SCHEMA,
			},
			health: {
				totalProcessed: 48210,
				totalErrors: 0,
				errorRate: 0,
				lastError: null,
				lastErrorAt: null,
				emptyMapping: false,
				violationCount: 0,
			},
			sync: SYNC_EXAMPLE,
			tables: {
				transfers: {
					endpoint: "/subgraphs/sbtc-flows/transfers",
					columns: {
						amount: { type: "uint" },
						sender: { type: "principal" },
						recipient: { type: "principal" },
						_id: { type: "serial" },
						_block_height: { type: "bigint" },
						_tx_id: { type: "text" },
						_created_at: { type: "timestamp" },
					},
					rowCount: 48138,
					example:
						"/subgraphs/sbtc-flows/transfers?_sort=_block_height&_order=desc&_limit=10",
				},
			},
			createdAt: "2026-09-21T09:14:52.000Z",
			updatedAt: "2026-09-23T14:02:11.000Z",
		},
	},
	SubgraphOperationQueued: {
		type: "object",
		description: "A reindex or backfill accepted into the queue.",
		required: ["message", "fromBlock", "toBlock", "operationId", "status"],
		properties: {
			message: { type: "string", description: "One-line summary." },
			fromBlock: {
				type: "integer",
				description: "First block. For a reindex, the subgraph's start block.",
			},
			toBlock: {
				type: ["integer", "string"],
				description:
					'Last block. For a reindex, the string `"chain tip"`: it runs to whatever the tip is when it gets there.',
			},
			operationId: {
				type: "string",
				format: "uuid",
				description: "Poll `/api/subgraphs/{name}/operations/{operation_id}`.",
			},
			status: {
				type: "string",
				enum: ["queued"],
				description: "Always `queued`.",
			},
		},
		example: {
			message: 'Backfill queued for subgraph "sbtc-flows"',
			fromBlock: 8950000,
			toBlock: 9000000,
			operationId: "9a4e7c21-0b3d-4f6a-8c15-e2d7b9f0a461",
			status: "queued",
		},
	},
	SubgraphOperation: {
		type: "object",
		description:
			"A reindex or backfill. One per subgraph can be queued or running at a time.",
		required: [
			"id",
			"subgraphName",
			"kind",
			"status",
			"weight",
			"progress",
			"createdAt",
			"updatedAt",
		],
		properties: {
			id: { type: "string", format: "uuid", description: "Operation id." },
			subgraphName: { type: "string", description: "Subgraph it runs on." },
			kind: {
				type: "string",
				enum: [...OPERATION_KINDS],
				description:
					"`reindex` drops and rebuilds; `backfill` re-runs a range in place.",
			},
			status: {
				type: "string",
				enum: [...OPERATION_STATUSES],
				description:
					"`queued` until a processor claims it. `completed`, `failed` and `cancelled` are final.",
			},
			weight: {
				type: "string",
				enum: [...OPERATION_WEIGHTS],
				description:
					"`light` for contract-scoped sources, `heavy` for broad ones. The processor limits how many heavy operations run at once.",
			},
			fromBlock: {
				type: ["integer", "null"],
				description:
					"First block. `null` on a reindex queued from `/reindex`, which starts at the subgraph's start block.",
			},
			toBlock: {
				type: ["integer", "null"],
				description: "Last block. `null` means the chain tip.",
			},
			processedBlocks: {
				type: ["integer", "null"],
				description: "Blocks covered. Set when the operation finishes.",
			},
			cursorBlock: {
				type: ["integer", "null"],
				description:
					"Backfills only: last committed block. A requeued backfill resumes after it.",
			},
			estimatedEvents: {
				type: ["integer", "null"],
				description:
					"Events expected, computed at enqueue for contract-scoped sources.",
			},
			processedEvents: {
				type: ["integer", "null"],
				description: "Events processed so far.",
			},
			progress: {
				type: ["number", "null"],
				minimum: 0,
				maximum: 1,
				description:
					"Fraction done, 0 to 1, from events when estimated, else blocks. `null` before any progress is reported.",
			},
			queuePosition: {
				type: "integer",
				description:
					"Queued only: approximate 1-based position. Show it as `~N`.",
			},
			error: {
				type: ["string", "null"],
				description: "Why it failed.",
			},
			startedAt: {
				type: ["string", "null"],
				format: "date-time",
				description: "When a processor claimed it.",
			},
			finishedAt: {
				type: ["string", "null"],
				format: "date-time",
				description: "When it reached a final status.",
			},
			createdAt: {
				type: "string",
				format: "date-time",
				description: "When it was queued.",
			},
			updatedAt: {
				type: "string",
				format: "date-time",
				description: "Last change.",
			},
		},
		example: {
			id: EXAMPLE_OPERATION_ID,
			subgraphName: "sbtc-flows",
			kind: "reindex",
			status: "running",
			weight: "light",
			fromBlock: 8000000,
			toBlock: EXAMPLE_TIP,
			processedBlocks: null,
			cursorBlock: null,
			estimatedEvents: 48210,
			processedEvents: 24105,
			progress: 0.5,
			error: null,
			startedAt: "2026-09-21T09:15:04.000Z",
			finishedAt: null,
			createdAt: "2026-09-21T09:14:53.000Z",
			updatedAt: "2026-09-21T09:18:37.000Z",
		},
	},
	SubgraphGap: {
		type: "object",
		description: "A block range the subgraph did not process.",
		required: ["start", "end", "size", "reason", "detectedAt", "resolvedAt"],
		properties: {
			start: { type: "integer", description: "First missing block." },
			end: { type: "integer", description: "Last missing block, inclusive." },
			size: { type: "integer", description: "Blocks in the range." },
			reason: {
				type: "string",
				enum: [...GAP_REASONS],
				description:
					"`block_missing`: the block was not in the index. `processing_error`: a handler threw.",
			},
			detectedAt: {
				type: "string",
				format: "date-time",
				description: "When it was recorded.",
			},
			resolvedAt: {
				type: ["string", "null"],
				format: "date-time",
				description: "When a later walk covered it. `null` while open.",
			},
		},
		example: {
			start: 8412207,
			end: 8412207,
			size: 1,
			reason: "processing_error",
			detectedAt: "2026-09-22T18:40:03.000Z",
			resolvedAt: null,
		},
	},
	SubgraphViolation: {
		type: "object",
		description:
			"A print event skipped because its payload did not match the declared `prints` schema.",
		required: [
			"id",
			"sourceName",
			"blockHeight",
			"txId",
			"reason",
			"samplePayload",
			"seenAt",
		],
		properties: {
			id: { type: "string", format: "uuid", description: "Violation id." },
			sourceName: {
				type: "string",
				description: "Source whose `prints` schema refused it.",
			},
			blockHeight: { type: "integer", description: "Block of the event." },
			txId: { type: "string", description: "Transaction of the event." },
			reason: {
				type: "string",
				description: "Which field was missing or had the wrong type.",
			},
			samplePayload: {
				type: "object",
				description: "The decoded print, as `topic` and `data`.",
			},
			seenAt: {
				type: "string",
				format: "date-time",
				description: "When it was skipped.",
			},
		},
		example: {
			id: "c41d8e27-6f0a-4b93-a5e2-7d19b3c8f056",
			sourceName: "swaps",
			blockHeight: 9031477,
			txId: "0x8d2f6a91c4e07b35d1a8f2e69c0b47d3a5e18f62b9c04d7e3a16f58b2c9d0e41",
			reason: 'missing declared field "amount-in"',
			samplePayload: {
				topic: "swap",
				data: {
					"amount-out": "1500000",
					sender: "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9",
				},
			},
			seenAt: "2026-09-23T11:27:45.000Z",
		},
	},
};
