import type { InstanceMode } from "@secondlayer/shared/mode";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { WEBHOOK_STATUSES } from "@secondlayer/shared/schemas/webhooks";
import { Hono } from "hono";
import {
	HOSTED_OPENAPI_PATHS,
	WORKLOAD_OPENAPI_PREFIXES,
} from "../route-manifest.ts";
import { corePaths, coreSchemas } from "./openapi/core.ts";
import { deploymentsPaths, deploymentsSchemas } from "./openapi/deployments.ts";
import { indexPaths, indexSchemas } from "./openapi/index.ts";
import { nodePaths, nodeSchemas } from "./openapi/node.ts";
import { protocolsPaths, protocolsSchemas } from "./openapi/protocols.ts";
import {
	AUTH_DESCRIPTION,
	ERROR_400,
	ERROR_401,
	ERROR_404,
	ERROR_429,
	READ_SECURITY,
	WRITE_SECURITY,
	json200,
	jsonBody,
	jsonError,
	ok,
} from "./openapi/shared.ts";
import { streamsPaths, streamsSchemas } from "./openapi/streams.ts";
import { subgraphsPaths, subgraphsSchemas } from "./openapi/subgraphs.ts";
import { webhooksPaths, webhooksSchemas } from "./openapi/webhooks.ts";

/**
 * Stable operationIds, keyed `METHOD path`. The docs reference turns each into
 * its `#` anchor (`listPox5Events` → `#list-pox5-events`), so renaming one
 * breaks every link anyone has shared. `openapi.test.ts` fails on an operation
 * missing here, a stale key, or a duplicate id.
 */
export const OPERATION_IDS: Record<string, string> = {
	"GET /v1": "discoverSurfaces",
	"POST /v1/batch": "batchRead",
	"GET /v1/openapi.json": "getOpenApiSpec",
	"POST /v1/archive/verify": "verifyArchive",
	"GET /v1/index": "discoverIndex",
	"GET /v1/index/events": "listEvents",
	"GET /v1/index/ft-transfers": "listFtTransfers",
	"GET /v1/index/nft-transfers": "listNftTransfers",
	"GET /v1/index/contract-calls": "listContractCalls",
	"GET /v1/index/canonical": "listCanonicalBlocks",
	"GET /v1/index/blocks": "listBlocks",
	"GET /v1/index/blocks/{height_or_hash}": "getBlock",
	"GET /v1/index/transactions": "listTransactions",
	"GET /v1/index/transactions/{tx_id}": "getTransaction",
	"GET /v1/index/transactions/{tx_id}/proof": "getTransactionProof",
	"GET /v1/index/stacking": "listPox4Stacking",
	"GET /v1/index/pox/cycles": "listPox4Cycles",
	"GET /v1/index/pox/cycles/{reward_cycle}": "getPox4Cycle",
	"GET /v1/index/pox5/events": "listPox5Events",
	"GET /v1/index/sbtc/events": "listSbtcEvents",
	"GET /v1/index/sbtc/deposits": "listSbtcDeposits",
	"GET /v1/index/sbtc/deposits/{bitcoin_txid}": "getSbtcDeposit",
	"GET /v1/index/sbtc/withdrawals": "listSbtcWithdrawals",
	"GET /v1/index/sbtc/withdrawals/{request_id}": "getSbtcWithdrawal",
	"GET /v1/index/sbtc/summary": "getSbtcSummary",
	"GET /v1/index/mempool": "listMempoolTransactions",
	"GET /v1/index/mempool/{tx_id}": "getMempoolTransaction",
	"GET /v1/index/contracts/{contract_id}/print-schema": "getPrintSchema",
	"GET /v1/streams": "discoverStreams",
	"GET /v1/streams/events": "listStreamEvents",
	"GET /v1/streams/events/stream": "tailStreamEvents",
	"GET /v1/streams/reorgs": "listReorgs",
	"GET /v1/streams/canonical/{height}": "getStreamsCanonicalBlock",
	"GET /v1/streams/tip": "getTip",
	"GET /v1/subgraphs": "listSubgraphs",
	"GET /v1/subgraphs/{name}": "getSubgraph",
	"GET /v1/subgraphs/{name}/openapi.json": "getSubgraphOpenApiSpec",
	"GET /v1/subgraphs/{name}/schema.json": "getSubgraphSchema",
	"GET /v1/subgraphs/{name}/docs.md": "getSubgraphDocs",
	"GET /v1/subgraphs/{name}/{table}": "listSubgraphRows",
	"GET /v1/subgraphs/{name}/{table}/count": "countSubgraphRows",
	"GET /v1/subgraphs/{name}/{table}/aggregate": "aggregateSubgraphRows",
	"GET /v1/subgraphs/{name}/{table}/stream": "tailSubgraphRows",
	"GET /v1/subgraphs/{name}/{table}/{id}": "getSubgraphRow",
	"GET /v1/instance": "getInstance",
	"GET /v1/instance/features": "getInstanceFeatures",
	"GET /v1/instance/metrics": "getInstanceMetrics",
	"GET /v1/play": "getPlay",
	"POST /v1/play": "runPlay",
	"GET /v1/play/estimate": "estimatePlay",
	"GET /api/subgraphs": "listDeployments",
	"POST /api/subgraphs": "deploySubgraph",
	"POST /api/subgraphs/bundle": "bundleSubgraph",
	"GET /api/subgraphs/{name}": "getDeployment",
	"DELETE /api/subgraphs/{name}": "deleteDeployment",
	"POST /api/subgraphs/{name}/reindex": "reindexDeployment",
	"POST /api/subgraphs/{name}/backfill": "backfillDeployment",
	"POST /api/subgraphs/{name}/stop": "stopDeployment",
	"GET /api/subgraphs/{name}/operations": "listDeploymentOperations",
	"GET /api/subgraphs/{name}/operations/{operation_id}":
		"getDeploymentOperation",
	"GET /api/subgraphs/{name}/gaps": "listDeploymentGaps",
	"GET /api/subgraphs/{name}/violations": "listDeploymentViolations",
	"GET /api/webhooks": "listWebhooks",
	"POST /api/webhooks": "createWebhook",
	"GET /api/webhooks/{id}": "getWebhook",
	"PATCH /api/webhooks/{id}": "updateWebhook",
	"DELETE /api/webhooks/{id}": "deleteWebhook",
	"POST /api/webhooks/{id}/pause": "pauseWebhook",
	"POST /api/webhooks/{id}/resume": "resumeWebhook",
	"POST /api/webhooks/{id}/rotate-secret": "rotateWebhookSecret",
	"POST /api/webhooks/{id}/test": "testWebhook",
	"GET /api/webhooks/{id}/deliveries": "listWebhookDeliveries",
	"GET /api/webhooks/{id}/dead": "listDeadWebhookEvents",
	"POST /api/webhooks/{id}/dead/{outbox_id}/requeue": "requeueDeadWebhookEvent",
	"POST /api/webhooks/{id}/replay": "replayWebhook",
	"GET /api/node/contracts/{contract_id}/abi": "getContractAbi",
	"POST /api/archive/quote": "quoteArchiveFetch",
	"POST /api/archive/fetch": "fetchArchivePartitions",
	"POST /api/billing/refill": "refillCredits",
	"GET /api/billing/status": "getBillingStatus",
	"POST /api/public/credits/checkout": "createCreditsCheckout",
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** Stamp each operation with its `OPERATION_IDS` entry. An operation missing
 *  from the map is left bare for `openapi.test.ts` to name. */
function withOperationIds(
	paths: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [path, item] of Object.entries(paths)) {
		const ops = { ...(item as Record<string, unknown>) };
		for (const method of HTTP_METHODS) {
			const op = ops[method];
			const id = OPERATION_IDS[`${method.toUpperCase()} ${path}`];
			if (op && id) ops[method] = { operationId: id, ...(op as object) };
		}
		out[path] = ops;
	}
	return out;
}

/**
 * Each tag file's resource schemas, by file. `openapi.test.ts` fails if two
 * files define the same name, since the spread below would silently keep one.
 */
export const SCHEMAS_BY_FILE = {
	core: coreSchemas,
	subgraphs: subgraphsSchemas,
	index: indexSchemas,
	protocols: protocolsSchemas,
	streams: streamsSchemas,
	deployments: deploymentsSchemas,
	webhooks: webhooksSchemas,
	node: nodeSchemas,
} as const;

const TAG_SCHEMAS = Object.assign({}, ...Object.values(SCHEMAS_BY_FILE));

/**
 * Display names for the objects the reference shows ("The PoX-5 event
 * object"). Schema names are code identifiers; these are what a reader sees.
 * `openapi.test.ts` fails if a returned object has no title.
 */
const SCHEMA_TITLES: Record<string, string> = {
	V1Discovery: "API discovery",
	BatchResponse: "batch response",
	ArchiveVerifyResult: "archive verification",
	IndexDiscovery: "Index discovery",
	IndexEvent: "Index event",
	FtTransfer: "FT transfer",
	NftTransfer: "NFT transfer",
	ContractCall: "contract call",
	CanonicalBlock: "canonical block",
	Block: "block",
	Transaction: "transaction",
	TransactionProof: "transaction proof",
	MempoolTransaction: "mempool transaction",
	PrintSchema: "print schema",
	StackingAction: "PoX-4 stacking action",
	PoxCycle: "PoX-4 reward cycle",
	Pox5Event: "PoX-5 event",
	SbtcEvent: "sBTC event",
	SbtcDeposit: "sBTC deposit",
	SbtcDepositDetail: "sBTC deposit detail",
	SbtcWithdrawal: "sBTC withdrawal",
	SbtcWithdrawalLifecycle: "sBTC withdrawal lifecycle",
	SbtcSummary: "sBTC summary",
	StreamsDiscovery: "Streams discovery",
	StreamsEvent: "Streams event",
	StreamsCanonicalBlock: "Streams canonical block",
	StreamsTip: "Streams tip",
	Reorg: "reorg",
	Tip: "Index tip",
	SubgraphDirectory: "subgraph directory",
	Subgraph: "subgraph",
	SubgraphOpenApiDocument: "subgraph OpenAPI document",
	SubgraphAgentSchema: "subgraph agent schema",
	SubgraphRowsPage: "subgraph rows page",
	SubgraphRow: "subgraph row",
	SubgraphRowCount: "subgraph row count",
	SubgraphAggregates: "subgraph aggregates",
	DeployedSubgraph: "deployed subgraph",
	DeployedSubgraphDetail: "deployed subgraph detail",
	SubgraphBundle: "subgraph bundle",
	SubgraphOperationQueued: "queued operation",
	SubgraphOperation: "subgraph operation",
	SubgraphGap: "subgraph gap",
	SubgraphViolation: "print validation skip",
	WebhookSummary: "webhook summary",
	Webhook: "webhook",
	WebhookWithSecret: "webhook with its signing secret",
	WebhookTestResult: "webhook test result",
	WebhookDelivery: "webhook delivery",
	WebhookDeadEvent: "dead-lettered webhook event",
	WebhookReplayResult: "webhook replay",
	ContractAbi: "contract ABI",
	InstanceCatalog: "instance catalog",
	InstanceFeatures: "instance feature manifest",
	InstanceMetrics: "instance metrics",
};

function withTitles<T extends Record<string, object>>(schemas: T): T {
	return Object.fromEntries(
		Object.entries(schemas).map(([name, schema]) => [
			name,
			SCHEMA_TITLES[name] && !("title" in schema)
				? { title: SCHEMA_TITLES[name], ...schema }
				: schema,
		]),
	) as T;
}

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
			name: "general",
			description:
				"Discover what this API serves, batch several reads into one request, and fetch this description.",
		},
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
			name: "archive",
			description:
				"Compare this instance against a signed archive. Read-only; nothing is uploaded but the manifest URL. Identity digests only.",
		},
		{
			name: "deployments",
			description:
				"Deploy, reindex, backfill, stop, and delete subgraphs on this instance (write plane, `/api`)",
		},
		{
			name: "webhooks",
			description:
				"Webhooks: register a URL, we match, sign, retry and POST (write plane, `/api`)",
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
					"The instance token from `secondlayer init`: 32 random bytes, hex-encoded, read from `INSTANCE_TOKEN`. Optional on `/v1` reads served over a loopback bind, required on every request once the instance is reachable past loopback, and required on every `/api` write whenever a token is set. Hosted `api.secondlayer.tools` uses an account key; see https://www.secondlayer.tools/docs/authentication.",
			},
		},
		schemas: withTitles({
			Tip: {
				type: "object",
				description:
					"The chain tip an Index read was served against (`IndexTip`, `src/index/tip.ts`).",
				properties: {
					block_height: {
						type: "integer",
						description:
							"Highest block the decoders have reached. Index rows stop here.",
					},
					finalized_height: {
						type: "integer",
						description:
							"Highest block past the finality boundary. Rows at or below it won't be reorged away.",
					},
					lag_seconds: {
						type: "integer",
						description: "Seconds since that block was produced.",
					},
					source_block_height: {
						type: "integer",
						description:
							"Highest block ingested from the node. Runs ahead of `block_height` while decoders catch up.",
					},
				},
				// Heights are a real mainnet snapshot (2026-09-23 14:00 UTC);
				// lag_seconds is illustrative.
				example: {
					block_height: 9048690,
					finalized_height: 9048457,
					lag_seconds: 4,
					source_block_height: 9048692,
				},
			},
			Reorg: {
				type: "object",
				description:
					"A fork the indexer rolled back. Rows inside `orphaned_range` were replaced; undo anything you committed from them.",
				properties: {
					id: { type: "string", description: "Reorg id." },
					detected_at: {
						type: "string",
						format: "date-time",
						description: "When the indexer saw the fork.",
					},
					fork_point_height: {
						type: "integer",
						description:
							"First block height the new fork replaced. Undo rows at or above it.",
					},
					old_index_block_hash: {
						type: ["string", "null"],
						description: "Index block hash of the abandoned tip.",
					},
					new_index_block_hash: {
						type: ["string", "null"],
						description: "Index block hash of the winning tip.",
					},
					orphaned_range: {
						type: "object",
						description:
							"First and last cursor of the rows that were replaced.",
						properties: {
							from: { type: "string", example: "7959998:0" },
							to: { type: "string", example: "7960000:41" },
						},
					},
					new_canonical_tip: {
						type: "string",
						description: "Cursor of the new canonical tip.",
						example: "7960000:42",
					},
				},
				// A real mainnet reorg, 2026-09-15.
				example: {
					id: "3f16c2c5-9551-4ae9-adb0-923668e5c65e",
					detected_at: "2026-09-15T15:39:38.129Z",
					fork_point_height: 8996511,
					old_index_block_hash:
						"0x45ba0195071488eda13afa66d8ce8612558a739f781be5a032d96332797c4174",
					new_index_block_hash:
						"0xa686ff58e7c5ccb26c850a7eaffa7e7274fcbc081c706344eb6f1e1446023df0",
					orphaned_range: { from: "8996511:0", to: "8996512:2701" },
					new_canonical_tip: "8996511:0",
				},
			},
			...TAG_SCHEMAS,
			InstanceFeatures: {
				type: "object",
				description: "The declared mode and the modules this instance runs.",
				properties: {
					mode: {
						type: "string",
						enum: ["oss", "platform", "archive"],
						description: "The mode the operator declared in `INSTANCE_MODE`.",
					},
					features: {
						type: "object",
						description:
							"Module flags. `protocolDatasets` says which protocol decoders are on; `signup`, `pricing` and `publicDirectory` are always false here.",
					},
				},
				example: {
					mode: "oss",
					features: {
						rawRest: true,
						rawSse: true,
						index: true,
						subgraphs: true,
						webhooks: true,
						contractDiscovery: true,
						verification: true,
						protocolDatasets: { sbtc: true, pox: true, bns: false },
						signup: false,
						pricing: false,
						publicDirectory: false,
						unsignedWebhooks: false,
					},
				},
			},
			InstanceCatalog: {
				type: "object",
				description: "What this instance is and holds.",
				properties: {
					mode: {
						type: "string",
						enum: ["oss", "platform", "archive"],
						description: "The mode the operator declared in `INSTANCE_MODE`.",
					},
					network: {
						type: "string",
						description: "`mainnet`, `testnet` or `devnet`.",
					},
					instance_id: {
						type: ["string", "null"],
						description: "This instance's id, or `null` before first boot.",
					},
					features: {
						type: "object",
						description: "Same manifest as `/v1/instance/features`.",
					},
					scope: {
						type: ["object", "null"],
						description:
							"The history this instance claims: `start_height`, optional `target_height`, and how it was acquired (`bootstrap.source` is `archive`, `genesis` or `import`, with the archive manifest digest when restored). `null` on an instance older than the scope table.",
					},
					subgraphs: {
						type: "array",
						description:
							"Deployed subgraphs: `name`, `status`, `start_block`, `last_processed_block`.",
						items: { type: "object" },
					},
					webhooks: {
						type: "array",
						description:
							"Webhooks: `name`, `status`, `kind` (`subgraph` or `chain`).",
						items: {
							type: "object",
							properties: {
								name: { type: "string" },
								status: { type: "string", enum: [...WEBHOOK_STATUSES] },
								kind: { type: "string", enum: ["subgraph", "chain"] },
							},
						},
					},
					console: {
						type: "object",
						description:
							"Console flags. Always false on a self-hosted instance.",
					},
				},
				example: {
					mode: "oss",
					network: "mainnet",
					instance_id: "0b6f1c9e-4a52-4f0e-9d8a-2c1e7b3d5a90",
					features: { index: true, subgraphs: true, webhooks: true },
					scope: {
						network: "mainnet",
						start_height: 8650000,
						target_height: null,
						bootstrap: {
							source: "archive",
							manifest_digest:
								"d1db4af398e9a0418095a48beef1c6c595070df3398f92ef16ef0fdb10daed1b",
							genesis_hash: null,
						},
					},
					subgraphs: [
						{
							name: "fastpool-signers",
							status: "active",
							start_block: 8665568,
							last_processed_block: 9048707,
						},
					],
					webhooks: [{ name: "pox5-stakes", status: "active", kind: "chain" }],
					console: { signup: false, pricing: false, publicDirectory: false },
				},
			},
			InstanceMetrics: {
				type: "object",
				description: "Operational vitals.",
				properties: {
					uptime_s: {
						type: "integer",
						description: "Seconds since the API process started.",
					},
					db_size_bytes: {
						type: ["integer", "null"],
						description:
							"Postgres database size, or `null` if it can't be read.",
					},
					deliveries_24h: {
						type: ["object", "null"],
						description:
							"Webhook deliveries in the last 24 hours: `total`, `failed` (no status or 400+), and `dlq` (events currently dead-lettered).",
					},
					rows_series: {
						type: "array",
						description:
							"Rows processed across all subgraphs, per hour over the last 24 hours: `{ t, rows }`.",
						items: { type: "object" },
					},
				},
				example: {
					uptime_s: 86400,
					db_size_bytes: 61203865600,
					deliveries_24h: { total: 460, failed: 2, dlq: 0 },
					rows_series: [{ t: "2026-09-23 13:00:00+00", rows: 3202 }],
				},
			},
			Error: {
				type: "object",
				properties: {
					error: {
						type: "string",
						description: "What went wrong, for a person.",
					},
					code: {
						type: "string",
						description: "Stable machine-readable code to branch on.",
						example: "VALIDATION_ERROR",
					},
				},
			},
		}),
		parameters: {
			Limit: {
				name: "limit",
				in: "query",
				schema: { type: "integer", minimum: 1, maximum: 1000 },
				description: "Page size; capped at 1000.",
			},
		},
	},
	paths: {
		...corePaths,
		...subgraphsPaths,
		...indexPaths,
		...protocolsPaths,
		...streamsPaths,
		...deploymentsPaths,
		...webhooksPaths,
		...nodePaths,
	},
};

/**
 * The document above describes a self-hosted instance, which is the product
 * every operator runs. The metered archive deployment is the specialization,
 * so it is derived here rather than the other way round:
 *
 *  - the workload plane is not mounted there (it 404s — `route-manifest.ts`),
 *    so those paths are dropped;
 *  - Index, Streams, and subgraphs are keyed (discovery GET `/v1/index` and
 *    `/v1/streams` stay open), so their bearer becomes required rather than
 *    optional;
 *  - the credential there is a minted account key, not an instance token.
 */
function platformSpec(): typeof OPENAPI_SPEC {
	const KEYED_PREFIXES = ["/v1/streams", "/v1/index", "/v1/subgraphs"];
	const paths: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(OPENAPI_SPEC.paths)) {
		if (isWorkloadPath(key)) continue;
		// Discovery GET `/v1/index` and `/v1/streams` stay open; key children.
		const keyed =
			key !== "/v1/index" &&
			key !== "/v1/streams" &&
			KEYED_PREFIXES.some((p) => key === p || key.startsWith(`${p}/`));
		paths[key] = keyed ? keyedOperations(value) : value;
	}
	Object.assign(paths, platformMeterPaths());
	return {
		...OPENAPI_SPEC,
		info: {
			...OPENAPI_SPEC.info,
			description:
				"The metered public archive. Index, Streams, and Subgraph reads require an account API key (`sk-sl_*`) as `Authorization: Bearer`. Discovery GET `/v1/index` and `/v1/streams` stay open. The workload plane is not served here.",
		},
		tags: [
			...OPENAPI_SPEC.tags.filter(
				(tag) =>
					!WORKLOAD_TAGS.includes(tag.name as (typeof WORKLOAD_TAGS)[number]) &&
					tag.name !== "archive",
			),
			{
				name: "archive",
				description:
					"Signed canonical archive fetch gate. Quote is free; fetch charges prepaid credits and returns presigned GET URLs.",
			},
			{
				name: "credits",
				description: "Prepaid archive credits.",
			},
			{
				name: "play",
				description:
					"Accountless hosted subgraph provision and claim. POST is unauthenticated; GET uses the play key; GET /v1/play/estimate uses X-Claim-Token.",
			},
		],
		components: {
			...OPENAPI_SPEC.components,
			securitySchemes: {
				bearerAuth: {
					type: "http",
					scheme: "bearer",
					bearerFormat: "sk-sl_*",
					description:
						"Account API key minted by the archive. Required on Index, Streams, and Subgraphs.",
				},
			},
		},
		paths,
	} as typeof OPENAPI_SPEC;
}

/** Metered archive + credits routes. Mounted only in platformSpec so the OSS
 *  document never advertises endpoints a self-hosted instance 404s. */
function platformMeterPaths(): Record<string, unknown> {
	const archiveBody = jsonBody({
		type: "object",
		required: ["paths", "flow"],
		properties: {
			paths: {
				type: "array",
				items: { type: "string" },
				description:
					"Manifest partition paths. Dataset is derived from each path; do not send a dataset field.",
			},
			flow: { type: "string", enum: ["bootstrap", "repair"] },
		},
	});
	return {
		"/api/archive/quote": {
			post: {
				tags: ["archive"],
				summary: "Quote a gated archive fetch",
				description:
					"Free, idempotent price preview. Never debits. Bearer is an account API key (`sk-sl_*`).",
				security: WRITE_SECURITY,
				requestBody: archiveBody,
				responses: {
					"200": json200({
						type: "object",
						properties: {
							partitions: { type: "integer" },
							bundles: { type: "number" },
							usd_micros: { type: "integer" },
							usd: { type: "string" },
							free_allowance_applied_micros: { type: "integer" },
							allowance_remaining_bundles: { type: "integer" },
							balance_usd_micros: { type: "integer" },
							sufficient: { type: "boolean" },
						},
					}),
					"400": jsonError(ERROR_400),
					"401": jsonError(ERROR_401),
					"503": jsonError("Archive gate is not configured"),
				},
			},
		},
		"/api/archive/fetch": {
			post: {
				tags: ["archive"],
				summary: "Charge and presign archive partitions",
				description:
					"Charges prepaid credits and returns presigned GET URLs. Max 64 paths per call; the SDK pages internally.",
				security: WRITE_SECURITY,
				requestBody: archiveBody,
				responses: {
					"200": json200({
						type: "object",
						properties: {
							urls: {
								type: "array",
								items: {
									type: "object",
									properties: {
										path: { type: "string" },
										url: { type: "string" },
										expires_at: { type: "string", format: "date-time" },
										charged_usd_micros: { type: "integer" },
									},
								},
							},
							charged_total_usd_micros: { type: "integer" },
							balance_after_usd_micros: { type: "integer" },
						},
					}),
					"400": jsonError(ERROR_400),
					"401": jsonError(ERROR_401),
					"402": jsonError("Insufficient archive credits"),
					"413": jsonError("Batch exceeds 64 paths"),
					"503": jsonError("Archive gate is not configured"),
				},
			},
		},
		"/api/billing/status": {
			get: {
				tags: ["credits"],
				summary: "Prepaid credits balance and refill config",
				security: WRITE_SECURITY,
				responses: {
					"200": json200({
						type: "object",
						properties: {
							stripeCustomerId: { type: ["string", "null"] },
							creditsUsdMicros: { type: "string" },
							creditsSpentThisMonthUsdMicros: { type: "string" },
							refill: {
								type: "object",
								properties: {
									belowUsd: { type: ["number", "null"] },
									packUsd: { type: ["integer", "null"] },
									lastAt: { type: ["string", "null"], format: "date-time" },
								},
							},
							webhook: { type: "null" },
						},
					}),
					"401": jsonError(ERROR_401),
					"404": jsonError(ERROR_404),
				},
			},
		},
		"/api/billing/refill": {
			post: {
				tags: ["credits"],
				summary: "Set auto-refill threshold",
				security: WRITE_SECURITY,
				requestBody: jsonBody({
					type: "object",
					required: ["belowUsd"],
					properties: {
						belowUsd: {
							type: ["number", "null"],
							description: "Trigger USD; `null` turns auto-refill off.",
						},
						packUsd: { type: "integer", enum: [10, 25, 50, 100] },
					},
				}),
				responses: {
					"200": json200({
						type: "object",
						properties: {
							belowUsd: { type: ["number", "null"] },
							packUsd: { type: ["integer", "null"] },
							lastAt: { type: ["string", "null"], format: "date-time" },
						},
					}),
					"400": jsonError(ERROR_400),
					"401": jsonError(ERROR_401),
				},
			},
		},
		"/api/public/credits/checkout": {
			post: {
				tags: ["credits"],
				summary: "Guest credits checkout",
				description:
					"No bearer. Email is the identity; returns a Stripe Checkout URL.",
				security: [],
				requestBody: jsonBody({
					type: "object",
					required: ["email", "amount"],
					properties: {
						email: { type: "string" },
						amount: { type: "integer", enum: [10, 25, 50, 100] },
						claim_token: {
							type: "string",
							description:
								"Raw play claim token. Stored hashed on the Checkout session; never the raw value.",
						},
					},
				}),
				responses: {
					"200": json200({
						type: "object",
						properties: { url: { type: "string" } },
					}),
					"400": jsonError(ERROR_400),
					"503": jsonError("Billing is not configured"),
				},
			},
		},
		"/v1/play": {
			post: {
				tags: ["play"],
				summary: "Provision a play subgraph",
				description:
					"Anonymous. Creates one subgraph and an optional webhook on a ghost account. Returns a read-only API key and a claim URL. Three provisions per IP per UTC day.",
				security: [],
				requestBody: jsonBody({
					type: "object",
					required: ["subgraph"],
					properties: {
						subgraph: {
							type: "object",
							description: "Same body as POST /api/subgraphs.",
						},
						webhook: {
							type: "object",
							description: "Optional. Same fields as POST /api/webhooks.",
						},
					},
				}),
				responses: {
					"201": json200({
						type: "object",
						properties: {
							key: { type: "string" },
							claim_url: { type: "string" },
							claim_expires_at: { type: "string", format: "date-time" },
							subgraph: {
								type: "object",
								properties: {
									name: { type: "string" },
									expires_at: { type: "string", format: "date-time" },
								},
							},
						},
					}),
					"400": jsonError(ERROR_400),
					"429": jsonError(ERROR_429),
				},
			},
			get: {
				tags: ["play"],
				summary: "Play session status",
				description:
					"Bearer must be the play key. Returns 404 after the ghost is claimed.",
				security: WRITE_SECURITY,
				responses: {
					"200": json200({
						type: "object",
						properties: {
							subgraphs: {
								type: "array",
								items: {
									type: "object",
									properties: {
										name: { type: "string" },
										expires_at: {
											type: ["string", "null"],
											format: "date-time",
										},
									},
								},
							},
							claim_expires_at: {
								type: ["string", "null"],
								format: "date-time",
							},
						},
					}),
					"401": jsonError(ERROR_401),
					"404": jsonError(ERROR_404),
				},
			},
		},
		"/v1/play/estimate": {
			get: {
				tags: ["play"],
				summary: "Play session monthly cost estimate",
				description:
					"Authenticates with X-Claim-Token. Does not consume the token. Returns dollar strings for the claim page. Play-only; 404 after the ghost is claimed.",
				security: [],
				parameters: [
					{
						name: "X-Claim-Token",
						in: "header",
						required: true,
						schema: { type: "string" },
						description:
							"Unused, unexpired play claim token. Lookup only; used_at is not set.",
					},
				],
				responses: {
					"200": json200({
						type: "object",
						properties: {
							grant_remaining_usd: { type: "string" },
							grant_spent_usd: { type: "string" },
							projected_monthly_usd: { type: "string" },
							lines: {
								type: "array",
								items: {
									type: "object",
									properties: {
										meter: { type: "string" },
										usd: { type: "string" },
										one_shot: { type: "boolean" },
									},
								},
							},
						},
					}),
					"400": jsonError(ERROR_400),
					"404": jsonError(ERROR_404),
				},
			},
		},
	};
}

/** Tags that only exist on the write plane. */
const WORKLOAD_TAGS = ["deployments", "webhooks", "node"] as const;

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
	if (mode === "platform") {
		const spec = platformSpec();
		return { ...spec, paths: withOperationIds(spec.paths) } as typeof spec;
	}
	const paths: Record<string, unknown> = { ...OPENAPI_SPEC.paths };
	for (const key of HOSTED_OPENAPI_PATHS) {
		delete paths[key];
	}
	paths["/v1/instance"] = {
		get: {
			tags: ["instance"],
			summary: "Local instance catalog",
			description:
				"What this instance is and holds: its mode and network, the feature manifest, the history it claims, and the subgraphs and webhooks deployed on it. No signup or pricing, ever.",
			security: READ_SECURITY,
			responses: ok(
				json200(
					{ $ref: "#/components/schemas/InstanceCatalog" },
					"The catalog. If the database is unreachable, lists come back empty rather than failing.",
				),
			),
		},
	};
	paths["/v1/instance/features"] = {
		get: {
			tags: ["instance"],
			summary: "Default feature manifest",
			description:
				"Which modules this instance runs, including which protocol decoders are on.",
			security: READ_SECURITY,
			responses: ok(
				json200(
					{ $ref: "#/components/schemas/InstanceFeatures" },
					"The declared mode and feature manifest.",
				),
			),
		},
	};
	paths["/v1/instance/metrics"] = {
		get: {
			tags: ["instance"],
			summary: "Operational vitals",
			description:
				"Process uptime, database size, the last 24 hours of webhook delivery outcomes, and rows processed per hour. A value that can't be measured comes back `null` instead of failing the request.",
			security: READ_SECURITY,
			responses: ok(
				json200(
					{ $ref: "#/components/schemas/InstanceMetrics" },
					"Current vitals.",
				),
			),
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
		paths: withOperationIds(paths),
	} as typeof OPENAPI_SPEC;
}

export function createOpenApiRouter() {
	const router = new Hono();
	router.get("/", (c) => c.json(openapiSpec()));
	return router;
}

export default createOpenApiRouter();
