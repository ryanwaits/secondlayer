import { MAX_RANGES_WITHOUT_WINDOW } from "../archive-verify.ts";
import { BATCH_MAX_ITEMS } from "../batch.ts";
import {
	ERROR_401,
	READ_SECURITY,
	json200,
	jsonBody,
	jsonError,
} from "./shared.ts";

/** Instance-level `/v1` routes: discovery, batch, archive verify, this spec. */

const BATCH_EXAMPLE_REQUEST = {
	requests: [
		{ path: "/v1/streams/tip" },
		{ path: "/v1/streams/canonical/9048876" },
		{ path: "/api/subgraphs" },
	],
};

export const corePaths = {
	"/v1": {
		get: {
			tags: ["general"],
			summary: "Surface discovery",
			description:
				"Lists the public read surfaces on this instance, where this document lives, the list envelope shape, and the cursor format. A starting point for an agent that has only the base URL.",
			security: READ_SECURITY,
			responses: {
				"200": json200(
					{ $ref: "#/components/schemas/V1Discovery" },
					"The surfaces this instance serves",
				),
				"401": jsonError(ERROR_401),
			},
		},
	},
	"/v1/batch": {
		post: {
			tags: ["general"],
			summary: "Batch public reads",
			description: `Up to ${BATCH_MAX_ITEMS} GET reads under \`/v1/index/\`, \`/v1/subgraphs\`, \`/v1/streams/\` and \`/v1/contracts\` in one round trip. Items run in parallel through the full app, so auth, rate limits and retention apply per item; the request's \`Authorization\` header is forwarded to every item. Results come back in request order, each with its own HTTP status and JSON body. A refused or failed item does not fail the batch.`,
			security: READ_SECURITY,
			requestBody: jsonBody({
				type: "object",
				required: ["requests"],
				properties: {
					requests: {
						type: "array",
						minItems: 1,
						maxItems: BATCH_MAX_ITEMS,
						description: `The reads to run, 1 to ${BATCH_MAX_ITEMS}.`,
						items: {
							type: "object",
							required: ["path"],
							properties: {
								path: {
									type: "string",
									description:
										"A path under `/v1/index/`, `/v1/subgraphs`, `/v1/streams/` or `/v1/contracts`. It may carry its own query string. Any other path, or one containing `..`, gets a per-item 400.",
								},
								params: {
									type: "object",
									additionalProperties: {
										type: ["string", "number", "boolean"],
									},
									description:
										"Query parameters, appended to `path` as a query string.",
								},
							},
						},
					},
				},
				example: BATCH_EXAMPLE_REQUEST,
			}),
			responses: {
				"200": json200(
					{ $ref: "#/components/schemas/BatchResponse" },
					"One result per request, in request order",
				),
				"400": jsonError(
					`The body is not \`{ requests: [...] }\`, \`requests\` is empty, or it holds more than ${BATCH_MAX_ITEMS} items (\`VALIDATION_ERROR\`)`,
				),
				"401": jsonError(ERROR_401),
			},
		},
	},
	"/v1/archive/verify": {
		post: {
			tags: ["archive"],
			summary: "Verify this instance against a signed archive",
			description: `Compares identity digests of this instance's blocks, transactions and events against the range digests in a signed archive manifest. Read-only: the instance fetches the manifest, nothing is uploaded. Semantic replay (\`--deep\`) is CLI only. Without \`from_block\` or \`to_block\`, a manifest with more than ${MAX_RANGES_WITHOUT_WINDOW} matching ranges is refused with 400. A missing key, an unreachable manifest, a failed signature or no matching digests answer 200 \`unanchored\` with a \`reason\`, never \`clean\`.`,
			security: READ_SECURITY,
			requestBody: jsonBody({
				type: "object",
				required: ["against"],
				properties: {
					against: {
						type: "string",
						format: "uri",
						description:
							"https URL of `latest.json` or a snapshot manifest. Local paths and plain http are refused.",
					},
					target: {
						type: "string",
						default: "raw",
						description:
							"`raw` (default) or `all` check blocks, transactions and events. `decode:<name>` and `subgraph:<name>` parse, but only raw datasets have digests, so they answer `unanchored` with `no digests`.",
					},
					from_block: {
						type: "integer",
						minimum: 0,
						description: `First height to check. Needed, with or without \`to_block\`, when the manifest has more than ${MAX_RANGES_WITHOUT_WINDOW} matching ranges.`,
					},
					to_block: {
						type: "integer",
						minimum: 0,
						description: "Last height to check. Must be at least `from_block`.",
					},
					insecure: {
						type: "boolean",
						default: false,
						description:
							"Compare even when the signature does not verify. `signature.verified` stays `false`.",
					},
					public_key_pem: {
						type: "string",
						description:
							"Archive signing key to verify with. Without it the instance uses `ARCHIVE_SIGNING_PUBLIC_KEY` (or `STREAMS_SIGNING_PUBLIC_KEY`); the hosted API also fetches the published key.",
					},
				},
				example: {
					against: "https://archive.secondlayer.tools/latest.json",
					target: "raw",
					from_block: 0,
					to_block: 99999,
				},
			}),
			responses: {
				"200": json200(
					{ $ref: "#/components/schemas/ArchiveVerifyResult" },
					"The comparison, or `unanchored` with the reason it could not run",
				),
				"400": jsonError(
					`The body is not JSON (\`INVALID_JSON\`), \`against\` is missing or not https, a field has the wrong type, \`target\` is not recognised, \`to_block\` is below \`from_block\`, or more than ${MAX_RANGES_WITHOUT_WINDOW} ranges matched without a height window (\`VALIDATION_ERROR\`)`,
				),
				"401": jsonError(ERROR_401),
			},
		},
	},
	"/v1/openapi.json": {
		get: {
			tags: ["general"],
			summary: "This document",
			description:
				"The OpenAPI 3.1 description of this instance, as JSON. It describes the instance's own mode: a self-hosted instance includes the `/api` write plane, the hosted archive leaves it out.",
			security: READ_SECURITY,
			responses: {
				"200": json200(
					{
						type: "object",
						description: "An OpenAPI 3.1 document.",
						properties: {
							openapi: {
								type: "string",
								description: "OpenAPI version, `3.1.0`.",
							},
							info: {
								type: "object",
								description: "Title, version and the auth overview.",
							},
							servers: {
								type: "array",
								items: { type: "object" },
								description: "Base URLs.",
							},
							tags: {
								type: "array",
								items: { type: "object" },
								description: "Operation groups.",
							},
							paths: {
								type: "object",
								description: "Every operation, keyed by path.",
							},
							components: {
								type: "object",
								description: "Shared schemas, parameters and security schemes.",
							},
						},
						example: {
							openapi: "3.1.0",
							info: { title: "Secondlayer Public API", version: "1.0.0" },
							servers: [
								{ url: "http://127.0.0.1:3800", description: "Local instance" },
							],
							tags: [
								{
									name: "streams",
									description:
										"Raw event firehose, chain tip, and reorg history",
								},
							],
							paths: {},
							components: {},
						},
					},
					"The OpenAPI document",
				),
				"401": jsonError(ERROR_401),
			},
		},
	},
};

/** Resource schemas for these responses, merged into `components.schemas`. */
export const coreSchemas = {
	V1Discovery: {
		type: "object",
		description: "The public read surfaces and how to page them.",
		required: ["surfaces", "openapi", "envelope_examples", "cursor_format"],
		properties: {
			surfaces: {
				type: "array",
				description:
					"Each surface's `name`, base `path`, a one-line `description`, and its `auth` rule.",
				items: {
					type: "object",
					properties: {
						name: { type: "string" },
						path: { type: "string" },
						description: { type: "string" },
						auth: { type: "string" },
					},
				},
			},
			openapi: {
				type: "string",
				description: "Path of this OpenAPI document.",
			},
			envelope_examples: {
				type: "object",
				description: "An illustrative cursor-paginated list envelope.",
			},
			cursor_format: {
				type: "string",
				description: "Index and Streams cursor format.",
			},
		},
		example: {
			surfaces: [
				{
					name: "index",
					path: "/v1/index",
					description:
						"Decoded chain events via /v1/index/events?event_type=… (stx/ft/nft transfers, mints, burns, stacking locks, and contract prints), with typed ft-transfers/nft-transfers aliases.",
					auth: "open on this instance",
				},
				{
					name: "streams",
					path: "/v1/streams",
					description:
						"Raw, ordered, cursor-paginated firehose with reorg awareness.",
					auth: "open on this instance",
				},
				{
					name: "subgraphs",
					path: "/v1/subgraphs",
					description:
						"Custom indexed views. Unique local name. Cursor envelope: { rows, next_cursor, tip }.",
					auth: "open on this instance",
				},
				{
					name: "instance",
					path: "/v1/instance",
					description:
						"Local catalog: instance status, subgraphs, webhooks, and default features. No signup or pricing.",
					auth: "open on this instance",
				},
			],
			openapi: "/v1/openapi.json",
			envelope_examples: {
				cursor_paginated: {
					events: ["..."],
					next_cursor: "7960000:42",
					tip: { block_height: 7978686, lag_seconds: 12 },
					reorgs: [
						{
							detected_at: "2026-05-16T00:00:00Z",
							new_canonical_tip: "7960000:42",
							new_canonical_height: 7960000,
							new_canonical_event_index: 42,
						},
					],
				},
			},
			cursor_format: "<block_height>:<event_index> (opaque resume token)",
		},
	},
	BatchResponse: {
		type: "object",
		description: "The batch results.",
		required: ["results"],
		properties: {
			results: {
				type: "array",
				description:
					"One entry per request, in order: the item's `path`, the HTTP `status` it got, and its JSON `body`. A path outside the allowed prefixes gets status 400; an item that throws gets status 500 with code `INTERNAL_ERROR`.",
				items: {
					type: "object",
					required: ["path", "status", "body"],
					properties: {
						path: {
							type: ["string", "null"],
							description: "The item's path as sent.",
						},
						status: {
							type: "integer",
							description: "The item's HTTP status.",
						},
						body: {
							description:
								"The item's JSON response body, or `{ error }` when it was not JSON.",
						},
					},
				},
			},
		},
		example: {
			results: [
				{
					path: "/v1/streams/tip",
					status: 200,
					body: {
						block_height: 9048928,
						block_hash:
							"0xe79ae38b78b37ad1f5d16c7afd04b4e202efe8d983d981803b785ca64257933f",
						burn_block_height: 968284,
						finalized_height: 9048671,
						lag_seconds: 4,
						oldest_seekable_height: null,
						oldest_cursor: null,
					},
				},
				{
					path: "/v1/streams/canonical/9048876",
					status: 200,
					body: {
						block_height: 9048876,
						block_hash:
							"0xba0676b375e8d5fc1495a02847cc3cc32b5f7c2113a5e73999d94ee8d75ebde4",
						burn_block_height: 968284,
						burn_block_hash:
							"0x00000000000000000001b1cadea50180db28922325872c9f16ca19edda3f8bae",
						is_canonical: true,
					},
				},
				{
					path: "/api/subgraphs",
					status: 400,
					body: {
						error: "Path not allowed in batch (public /v1 reads only)",
						code: "VALIDATION_ERROR",
					},
				},
			],
		},
	},
	ArchiveVerifyResult: {
		type: "object",
		description: "The outcome of an archive comparison.",
		required: ["status", "target", "against", "signature", "ranges"],
		properties: {
			status: {
				type: "string",
				enum: ["clean", "diverged", "unanchored"],
				description:
					"`clean`: every range matched. `diverged`: at least one did not. `unanchored`: the comparison could not be trusted or run; see `reason`.",
			},
			target: {
				type: "string",
				description:
					"The target that ran, normalised (`raw`, `all`, `decode:<name>`, `subgraph:<name>`).",
			},
			against: { type: "string", description: "The manifest URL, as sent." },
			signature: {
				type: "object",
				description:
					"Whether the manifest signature verified, and why not when it did not.",
				properties: {
					verified: { type: "boolean" },
					reason: { type: "string" },
				},
			},
			coverage: {
				type: "object",
				description:
					"Lowest and highest height compared. Absent when nothing was compared.",
				properties: {
					from_block: { type: "integer" },
					to_block: { type: "integer" },
				},
			},
			ranges: {
				type: "array",
				description:
					"One row per compared range. `status` is `match`, `digest-mismatch`, `count-mismatch`, or `missing` when this instance has no rows there. Digests are `null` for an empty range.",
				items: {
					type: "object",
					properties: {
						dataset: {
							type: "string",
							enum: ["blocks", "transactions", "events"],
						},
						from_block: { type: "integer" },
						to_block: { type: "integer" },
						status: {
							type: "string",
							enum: ["match", "digest-mismatch", "count-mismatch", "missing"],
						},
						expected_digest: { type: ["string", "null"] },
						actual_digest: { type: ["string", "null"] },
					},
				},
			},
			reason: {
				type: "string",
				description:
					"Why the result is `unanchored`: `no public key`, the fetch error, the signature failure, or `no digests`.",
			},
		},
		example: {
			status: "diverged",
			target: "raw",
			against: "https://archive.secondlayer.tools/latest.json",
			signature: { verified: true },
			coverage: { from_block: 0, to_block: 99999 },
			ranges: [
				{
					dataset: "blocks",
					from_block: 0,
					to_block: 49999,
					status: "match",
					expected_digest: "5d41402abc4b2a76b9719d911017c592",
					actual_digest: "5d41402abc4b2a76b9719d911017c592",
				},
				{
					dataset: "blocks",
					from_block: 50000,
					to_block: 99999,
					status: "digest-mismatch",
					expected_digest: "7d793037a0760186574b0282f2f435e7",
					actual_digest: "e2fc714c4727ee9395f324cd2e7f331f",
				},
			],
		},
	},
};
