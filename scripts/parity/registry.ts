/**
 * The capability registry — walking skeleton.
 *
 * One entry per platform verb for the three families with the worst measured
 * drift: streams, subgraphs, subscriptions. Each entry records the verb's
 * spelling on every door. `conform.ts` diffs this against the extractor
 * outputs in `out/`.
 *
 * Conventions per surface key in `surfaces`:
 *   - string / string[]  the verb exists on that door under these identifiers
 *   - null               GAP: the verb should exist on that door and does not
 *   - key absent         intentionally not on that door; say why in `naReason`
 */

export type Door = "cli" | "sdk" | "mcp" | "http";

export interface Capability {
	id: string;
	title: string;
	kind: "read" | "write" | "lifecycle";
	/** Read capability an agent calls to confirm this write landed. */
	verify?: string;
	surfaces: Partial<Record<Door, string | string[] | null>>;
	naReason?: Partial<Record<Door, string>>;
}

/**
 * Extract items inside the three families that no capability claims, with the
 * reason they are excluded. Anything else unclaimed is a conformance finding.
 */
export const EXCLUDED: Record<string, string> = {
	"cli:subgraphs codegen": "deprecated alias of `codegen subgraph`",
	"cli:subgraphs client": "deprecated alias of `codegen client`",
	"sdk:trigger":
		"chain-trigger builder DSL; authoring helper for subscriptions.create",
	"sdk:trigger.*": "chain-trigger builder members (17); same as trigger",
};

export const FAMILIES = ["streams", "subgraphs", "subscriptions"] as const;

export const capabilities: Capability[] = [
	// ── streams ─────────────────────────────────────────────────────────────
	{
		id: "streams.discover",
		title: "Discover the streams surface",
		kind: "read",
		surfaces: { http: "GET /v1/streams" },
		naReason: {
			cli: "discovery root is an HTTP affordance; --help covers the CLI",
			sdk: "typed client makes discovery unnecessary",
			mcp: "tool listing is MCP's native discovery",
		},
	},
	{
		id: "streams.tip",
		title: "Current chain tip",
		kind: "read",
		surfaces: {
			cli: "streams tip",
			sdk: "streams.tip",
			mcp: null,
			http: "GET /v1/streams/tip",
		},
	},
	{
		id: "streams.events.list",
		title: "List events (one page)",
		kind: "read",
		surfaces: {
			cli: "streams events",
			sdk: "streams.events.list",
			mcp: null,
			http: "GET /v1/streams/events",
		},
	},
	{
		id: "streams.events.byTx",
		title: "Events emitted by one transaction",
		kind: "read",
		surfaces: {
			cli: "streams events by-tx",
			sdk: "streams.events.byTxId",
			mcp: null,
			http: "GET /v1/streams/events/:tx_id",
		},
	},
	{
		id: "streams.follow",
		title: "Follow events live",
		kind: "read",
		surfaces: {
			cli: "streams consume",
			sdk: [
				"streams.consume",
				"streams.events.consume",
				"streams.events.subscribe",
				"streams.events.stream",
				"streams.events.replay",
			],
			mcp: null,
			http: "GET /v1/streams/events/stream",
		},
	},
	{
		id: "streams.reorgs",
		title: "Reorg history",
		kind: "read",
		surfaces: {
			cli: "streams reorgs",
			sdk: "streams.reorgs.list",
			mcp: null,
			http: "GET /v1/streams/reorgs",
		},
	},
	{
		id: "streams.canonical",
		title: "Canonical block at height",
		kind: "read",
		surfaces: {
			cli: "streams canonical",
			sdk: "streams.canonical",
			mcp: null,
			http: "GET /v1/streams/canonical/:height",
		},
	},
	{
		id: "streams.blockEvents",
		title: "Events in one block",
		kind: "read",
		surfaces: {
			cli: "streams block-events",
			sdk: "streams.blocks.events",
			mcp: null,
			http: "GET /v1/streams/blocks/:heightOrHash/events",
		},
	},
	{
		id: "streams.dumps",
		title: "Bulk parquet dumps",
		kind: "read",
		surfaces: {
			cli: "streams pull",
			sdk: [
				"streams.dumps.list",
				"streams.dumps.fileUrl",
				"streams.dumps.download",
			],
			mcp: "streams_dumps",
			http: "GET /public/streams/dumps/manifest",
		},
	},

	// ── subgraphs ───────────────────────────────────────────────────────────
	{
		id: "subgraphs.scaffold",
		title: "Author a new subgraph",
		kind: "write",
		verify: "subgraphs.status",
		surfaces: {
			cli: ["subgraphs create", "subgraphs scaffold"],
			mcp: "scaffold_from_contract",
		},
		naReason: {
			sdk: "authoring is local codegen; lives in @secondlayer/scaffold",
			http: "authoring never leaves the developer's machine",
		},
	},
	{
		id: "subgraphs.dev",
		title: "Local dev loop",
		kind: "lifecycle",
		surfaces: { cli: "subgraphs dev" },
		naReason: {
			sdk: "local watch loop is a CLI affordance",
			mcp: "long-lived watch process does not fit tool-call semantics",
			http: "local-only",
		},
	},
	{
		id: "subgraphs.test",
		title: "Run subgraph tests",
		kind: "lifecycle",
		surfaces: { cli: "subgraphs test" },
		naReason: {
			sdk: "test harness ships in @secondlayer/subgraphs/testing",
			mcp: "agents run tests through the CLI",
			http: "local-only",
		},
	},
	{
		id: "subgraphs.deploy",
		title: "Deploy a subgraph",
		kind: "write",
		verify: "subgraphs.status",
		surfaces: {
			cli: "subgraphs deploy",
			sdk: ["subgraphs.deploy", "subgraphs.bundle"],
			mcp: "subgraphs_deploy",
			http: ["POST /api/subgraphs", "POST /api/subgraphs/bundle"],
		},
	},
	{
		id: "subgraphs.list",
		title: "List subgraphs",
		kind: "read",
		surfaces: {
			cli: "subgraphs list",
			sdk: "subgraphs.list",
			mcp: "subgraphs_list",
			http: ["GET /api/subgraphs", "GET /v1/subgraphs"],
		},
	},
	{
		id: "subgraphs.status",
		title: "One subgraph's status",
		kind: "read",
		surfaces: {
			cli: "subgraphs status",
			sdk: ["subgraphs.get", "getSubgraph"],
			mcp: "subgraphs_get",
			http: [
				"GET /api/subgraphs/:subgraphName",
				"GET /v1/subgraphs/:subgraphName",
			],
		},
	},
	{
		id: "subgraphs.spec",
		title: "Self-describing spec (agent JSON / OpenAPI / markdown)",
		kind: "read",
		surfaces: {
			cli: "subgraphs spec",
			sdk: ["subgraphs.schema", "subgraphs.openapi", "subgraphs.markdown"],
			mcp: null,
			http: [
				"GET /api/subgraphs/:subgraphName/schema.json",
				"GET /api/subgraphs/:subgraphName/openapi.json",
				"GET /api/subgraphs/:subgraphName/openapi",
				"GET /api/subgraphs/:subgraphName/docs.md",
				"GET /v1/subgraphs/:subgraphName/schema.json",
				"GET /v1/subgraphs/:subgraphName/openapi.json",
				"GET /v1/subgraphs/:subgraphName/docs.md",
			],
		},
	},
	{
		id: "subgraphs.query",
		title: "Query subgraph rows",
		kind: "read",
		surfaces: {
			cli: "subgraphs query",
			sdk: [
				"subgraphs.queryTable",
				"subgraphs.queryTableCount",
				"subgraphs.queryTableAggregate",
				"subgraphs.rows",
				"subgraphs.typed",
				"subgraphs.typed.findMany",
				"subgraphs.typed.count",
				"subgraphs.typed.aggregate",
			],
			mcp: "subgraphs_query",
			http: [
				"GET /api/subgraphs/:subgraphName/:tableName",
				"GET /api/subgraphs/:subgraphName/:tableName/:id",
				"GET /api/subgraphs/:subgraphName/:tableName/count",
				"GET /api/subgraphs/:subgraphName/:tableName/aggregate",
				"GET /v1/subgraphs/:subgraphName/:tableName",
				"GET /v1/subgraphs/:subgraphName/:tableName/:id",
				"GET /v1/subgraphs/:subgraphName/:tableName/count",
				"GET /v1/subgraphs/:subgraphName/:tableName/aggregate",
			],
		},
	},
	{
		id: "subgraphs.follow",
		title: "Follow subgraph rows live",
		kind: "read",
		surfaces: {
			cli: null,
			sdk: "subgraphs.typed.subscribe",
			mcp: null,
			http: [
				"GET /api/subgraphs/:subgraphName/:tableName/stream",
				"GET /v1/subgraphs/:subgraphName/:tableName/stream",
			],
		},
	},
	{
		id: "subgraphs.reindex",
		title: "Reindex a subgraph",
		kind: "write",
		verify: "subgraphs.operations",
		surfaces: {
			cli: "subgraphs reindex",
			sdk: "subgraphs.reindex",
			mcp: "subgraphs_reindex",
			http: "POST /api/subgraphs/:subgraphName/reindex",
		},
	},
	{
		id: "subgraphs.backfill",
		title: "Backfill a range",
		kind: "write",
		verify: "subgraphs.operations",
		surfaces: {
			cli: "subgraphs backfill",
			sdk: "subgraphs.backfill",
			mcp: "subgraphs_backfill",
			http: "POST /api/subgraphs/:subgraphName/backfill",
		},
	},
	{
		id: "subgraphs.stop",
		title: "Stop / cancel an operation",
		kind: "write",
		verify: "subgraphs.operations",
		surfaces: {
			cli: "subgraphs cancel",
			sdk: "subgraphs.stop",
			mcp: "subgraphs_stop",
			http: "POST /api/subgraphs/:subgraphName/stop",
		},
	},
	{
		id: "subgraphs.gaps",
		title: "Coverage gaps",
		kind: "read",
		surfaces: {
			cli: "subgraphs gaps",
			sdk: "subgraphs.gaps",
			mcp: "subgraphs_gaps",
			http: "GET /api/subgraphs/:subgraphName/gaps",
		},
	},
	{
		id: "subgraphs.operations",
		title: "Operation history (the verify target)",
		kind: "read",
		surfaces: {
			cli: null,
			sdk: ["subgraphs.operations", "subgraphs.getOperation"],
			mcp: null,
			http: [
				"GET /api/subgraphs/:subgraphName/operations",
				"GET /api/subgraphs/:subgraphName/operations/:operationId",
			],
		},
	},
	{
		id: "subgraphs.source",
		title: "Retrieve deployed source",
		kind: "read",
		surfaces: {
			cli: null,
			sdk: "subgraphs.getSource",
			mcp: null,
			http: "GET /api/subgraphs/:subgraphName/source",
		},
	},
	{
		id: "subgraphs.publish",
		title: "Publish / unpublish publicly",
		kind: "write",
		verify: "subgraphs.status",
		surfaces: {
			cli: null,
			sdk: null,
			mcp: null,
			http: [
				"POST /api/subgraphs/:subgraphName/publish",
				"POST /api/subgraphs/:subgraphName/unpublish",
			],
		},
	},
	{
		id: "subgraphs.delete",
		title: "Delete a subgraph",
		kind: "write",
		verify: "subgraphs.list",
		surfaces: {
			cli: "subgraphs delete",
			sdk: "subgraphs.delete",
			mcp: "subgraphs_delete",
			http: "DELETE /api/subgraphs/:subgraphName",
		},
	},

	// ── subscriptions ───────────────────────────────────────────────────────
	{
		id: "subscriptions.create",
		title: "Create a subscription",
		kind: "write",
		verify: "subscriptions.get",
		surfaces: {
			cli: "subscriptions create",
			sdk: "subscriptions.create",
			mcp: "subscriptions_create",
			http: "POST /api/subscriptions",
		},
	},
	{
		id: "subscriptions.list",
		title: "List subscriptions",
		kind: "read",
		surfaces: {
			cli: "subscriptions list",
			sdk: "subscriptions.list",
			mcp: "subscriptions_list",
			http: "GET /api/subscriptions",
		},
	},
	{
		id: "subscriptions.get",
		title: "One subscription",
		kind: "read",
		surfaces: {
			cli: "subscriptions get",
			sdk: "subscriptions.get",
			mcp: "subscriptions_get",
			http: "GET /api/subscriptions/:id",
		},
	},
	{
		id: "subscriptions.update",
		title: "Update a subscription",
		kind: "write",
		verify: "subscriptions.get",
		surfaces: {
			cli: "subscriptions update",
			sdk: "subscriptions.update",
			mcp: "subscriptions_update",
			http: "PATCH /api/subscriptions/:id",
		},
	},
	{
		id: "subscriptions.delete",
		title: "Delete a subscription",
		kind: "write",
		verify: "subscriptions.list",
		surfaces: {
			cli: "subscriptions delete",
			sdk: "subscriptions.delete",
			mcp: "subscriptions_delete",
			http: "DELETE /api/subscriptions/:id",
		},
	},
	{
		id: "subscriptions.pause",
		title: "Pause deliveries",
		kind: "write",
		verify: "subscriptions.get",
		surfaces: {
			cli: "subscriptions pause",
			sdk: "subscriptions.pause",
			mcp: null,
			http: "POST /api/subscriptions/:id/pause",
		},
	},
	{
		id: "subscriptions.resume",
		title: "Resume deliveries",
		kind: "write",
		verify: "subscriptions.get",
		surfaces: {
			cli: "subscriptions resume",
			sdk: "subscriptions.resume",
			mcp: null,
			http: "POST /api/subscriptions/:id/resume",
		},
	},
	{
		id: "subscriptions.rotateSecret",
		title: "Rotate signing secret",
		kind: "write",
		verify: "subscriptions.get",
		surfaces: {
			cli: "subscriptions rotate-secret",
			sdk: "subscriptions.rotateSecret",
			mcp: null,
			http: "POST /api/subscriptions/:id/rotate-secret",
		},
	},
	{
		id: "subscriptions.test",
		title: "Send a test delivery",
		kind: "write",
		verify: "subscriptions.deliveries",
		surfaces: {
			cli: "subscriptions test",
			sdk: "subscriptions.test",
			mcp: "subscriptions_test",
			http: "POST /api/subscriptions/:id/test",
		},
	},
	{
		id: "subscriptions.replay",
		title: "Replay past deliveries",
		kind: "write",
		verify: "subscriptions.deliveries",
		surfaces: {
			cli: "subscriptions replay",
			sdk: "subscriptions.replay",
			mcp: "subscriptions_replay",
			http: "POST /api/subscriptions/:id/replay",
		},
	},
	{
		id: "subscriptions.deliveries",
		title: "Recent deliveries (the verify target)",
		kind: "read",
		surfaces: {
			cli: "subscriptions deliveries",
			sdk: "subscriptions.recentDeliveries",
			mcp: null,
			http: "GET /api/subscriptions/:id/deliveries",
		},
	},
	{
		id: "subscriptions.dead",
		title: "Dead-letter queue",
		kind: "read",
		surfaces: {
			cli: "subscriptions dead",
			sdk: "subscriptions.dead",
			mcp: null,
			http: "GET /api/subscriptions/:id/dead",
		},
	},
	{
		id: "subscriptions.requeue",
		title: "Requeue a dead delivery",
		kind: "write",
		verify: "subscriptions.deliveries",
		surfaces: {
			cli: "subscriptions requeue",
			sdk: "subscriptions.requeueDead",
			mcp: null,
			http: "POST /api/subscriptions/:id/dead/:outboxId/requeue",
		},
	},
	{
		id: "subscriptions.doctor",
		title: "Diagnose delivery problems",
		kind: "read",
		surfaces: { cli: "subscriptions doctor" },
		naReason: {
			sdk: "aggregate diagnostic composed from get + deliveries + dead",
			mcp: "same composition is available through the underlying tools",
			http: "no single endpoint; composed client-side",
		},
	},
];
