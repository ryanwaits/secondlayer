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
						"Semantic indexes of high-volume event types (FT/NFT transfers).",
					auth: "optional bearer for higher tier; anon allowed",
				},
				{
					name: "streams",
					path: "/v1/streams",
					description:
						"Raw, ordered, cursor-paginated firehose with reorg awareness.",
					auth: "bearer required (Build+ tier)",
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
