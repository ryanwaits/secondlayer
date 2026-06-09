import { Hono } from "hono";

/** GET /v1 — surface discovery. Lists the three public surfaces and where
 *  their per-surface indexes / OpenAPI live. Anonymous, no rate limit. */
export function createV1IndexRouter() {
	const router = new Hono();

	router.get("/", (c) =>
		c.json({
			surfaces: [
				{
					name: "datasets",
					path: "/v1/datasets",
					description:
						"Curated, anon-readable datasets covering common chain questions.",
					auth: "none",
				},
				{
					name: "index",
					path: "/v1/index",
					description:
						"Decoded chain events via /v1/index/events?event_type=… (FT/NFT transfers today), with typed ft-transfers/nft-transfers aliases.",
					auth: "optional bearer for higher tier; anon allowed",
				},
				{
					name: "streams",
					path: "/v1/streams",
					description:
						"Raw, ordered, cursor-paginated firehose with reorg awareness.",
					auth: "bearer required (Build+ tier)",
				},
				{
					name: "subgraphs",
					path: "/v1/subgraphs",
					description:
						"Custom indexed views (deployed subgraphs). Public subgraphs are anon-readable; private ones need the owning account's bearer key. Cursor envelope: { rows, next_cursor, tip }.",
					auth: "none for public subgraphs; bearer for private",
				},
				{
					name: "api-keys",
					path: "/v1/api-keys",
					description:
						"POST to mint a scoped streams/index read key so an agent can self-provision access. Returns the key once.",
					auth: "bearer required (account-level owner key)",
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
		}),
	);

	return router;
}

export default createV1IndexRouter();
