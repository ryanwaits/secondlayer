import { beforeAll, describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TYPE_MAP } from "@secondlayer/subgraphs/schema";
import {
	SubgraphFilterSchema,
	VALID_FILTER_TYPES,
} from "@secondlayer/subgraphs/validate";
import type { getClient } from "./lib/client.ts";
import { getRegisteredToolNames } from "./lib/tool.ts";
import {
	COLUMN_TYPES,
	FILTERS_REFERENCE,
	buildCapabilities,
	buildContext,
	registerResources,
} from "./resources.ts";
import { createServer } from "./server.ts";

interface RegisteredResource {
	uri: string;
	read: () => Promise<{ contents: Array<{ text: string }> }>;
}

function captureResources(): RegisteredResource[] {
	const resources: RegisteredResource[] = [];
	registerResources({
		resource: (
			_name: string,
			uri: string,
			_opts: unknown,
			read: RegisteredResource["read"],
		) => {
			resources.push({ uri, read });
		},
	} as unknown as McpServer);
	return resources;
}

type Client = ReturnType<typeof getClient>;

// Registering all tools populates the global tool registry that
// buildCapabilities reads (mirrors production: register*Tools run before any
// context read). Without this the registry is empty and capabilities are blank.
beforeAll(() => {
	createServer();
});

describe("secondlayer://context", () => {
	it("assembles live state from the SDK context snapshot", async () => {
		const client = {
			context: async () => ({
				account: { email: "a@b.com", plan: "build" },
				streamsTip: {
					block_height: 100,
					block_hash: "0xabc",
					burn_block_height: 50,
					lag_seconds: 2,
				},
				indexTip: { block_height: 99, lag_seconds: 3 },
				subgraphs: [
					{
						name: "swaps",
						status: "running",
						tables: ["t"],
						lastProcessedBlock: 5,
					},
				],
				subscriptions: { count: 2, byStatus: { active: 1, paused: 1 } },
				projects: [{ name: "My App", slug: "my-app", network: "mainnet" }],
				apiKeys: [
					{
						prefix: "sk-sl_a",
						name: "ci",
						status: "active",
						product: "streams",
					},
				],
				activeOperations: [],
			}),
		} as unknown as Client;

		const ctx = await buildContext({ clientProvider: () => client });

		expect(Array.isArray(ctx.whatExists.subgraphs)).toBe(true);
		expect(ctx.whatExists.projects).toEqual([
			{ name: "My App", slug: "my-app", network: "mainnet" },
		]);
		expect(ctx.whatExists.apiKeys).toEqual([
			{ prefix: "sk-sl_a", name: "ci", status: "active", product: "streams" },
		]);
		expect(ctx.whatExists.subscriptions).toEqual({
			count: 2,
			byStatus: { active: 1, paused: 1 },
		});
		expect(ctx.whatExists.account).toEqual({ email: "a@b.com", plan: "build" });
		expect(ctx.whatExists.streamsTip).toEqual({
			block_height: 100,
			block_hash: "0xabc",
			burn_block_height: 50,
			lag_seconds: 2,
		});
		expect(ctx.whatExists.activeOperations).toEqual([]);
		expect(ctx.whatYouCanDo.products.length).toBeGreaterThan(0);
		expect(ctx.readAuthTiers.streams).toContain("SL_API_KEY");
	});

	it("degrades gracefully when a field is unavailable (never throws)", async () => {
		const client = {
			context: async () => ({
				account: null,
				streamsTip: null,
				indexTip: null,
				subgraphs: [],
				subscriptions: null,
				projects: null,
				apiKeys: null,
				activeOperations: null,
			}),
		} as unknown as Client;

		const ctx = await buildContext({ clientProvider: () => client });

		expect(ctx.whatExists.subgraphs).toEqual([]);
		expect(ctx.whatExists.subscriptions).toBe("unavailable: set SL_API_KEY");
		expect(ctx.whatExists.projects).toBe("unavailable: set SL_API_KEY");
		expect(ctx.whatExists.apiKeys).toBe("unavailable: set SL_API_KEY");
		expect(ctx.whatExists.account).toBe("unavailable: set SL_API_KEY");
		expect(ctx.whatExists.streamsTip).toBe("unavailable: set SL_API_KEY");
	});
});

describe("column-types ↔ subgraphs TYPE_MAP", () => {
	// Guards against the served column-type reference drifting behind the deployer's
	// TYPE_MAP (which is what actually creates the columns). If this fails, a type
	// was added/renamed in subgraphs — the resource is derived, so fix TYPE_MAP /
	// COLUMN_TYPE_DESCRIPTIONS, never hand-edit the served list.
	const typeEntries = COLUMN_TYPES.filter((e) => "type" in e);

	it("serves exactly the TYPE_MAP column types", () => {
		const served = typeEntries.map((e) => e.type).sort();
		expect(served).toEqual(Object.keys(TYPE_MAP).sort());
	});

	it("maps every type to its real SQL type (not a stale alias)", () => {
		for (const e of typeEntries) {
			expect(e.sqlType).toBe(TYPE_MAP[e.type as keyof typeof TYPE_MAP]);
		}
		// Lock the specific drift the audit caught: NUMERIC (not bigint), boolean/jsonb.
		const byType = new Map(typeEntries.map((e) => [e.type, e.sqlType]));
		expect(byType.get("uint")).toBe("NUMERIC");
		expect(byType.get("boolean")).toBe("BOOLEAN");
		expect(byType.get("timestamp")).toBe("TIMESTAMPTZ");
	});

	it("has a description for every type", () => {
		for (const e of typeEntries) {
			expect(typeof e.description).toBe("string");
			expect((e.description as string).length).toBeGreaterThan(0);
		}
	});
});

describe("filters ↔ subgraphs SubgraphFilter validator", () => {
	// Guards against the served filter reference advertising a type or field the
	// validator rejects (the audit's "agents emit validator-rejected schemas").
	// The per-type field breakdown is hand-authored, but locked here: every type
	// must be in VALID_FILTER_TYPES and every field must be an accepted key of the
	// `.strict()` SubgraphFilterSchema.
	// biome-ignore lint/suspicious/noExplicitAny: zod-internal shape access to read accepted keys
	const shape = (SubgraphFilterSchema as any)._zod.def.shape as Record<
		string,
		unknown
	>;
	const allowedFields = new Set(Object.keys(shape));

	it("serves exactly the validator's filter types", () => {
		const served = FILTERS_REFERENCE.map((f) => f.type).sort();
		expect(served).toEqual([...VALID_FILTER_TYPES].sort());
	});

	it("never advertises a field the .strict() validator rejects", () => {
		for (const filter of FILTERS_REFERENCE) {
			for (const field of filter.fields) {
				expect(allowedFields.has(field)).toBe(true);
			}
		}
	});

	it("locks the specific drift the audit caught", () => {
		const byType = new Map(FILTERS_REFERENCE.map((f) => [f.type, f.fields]));
		// contract_call: contractId/functionName/caller (was contract/function)
		expect(byType.get("contract_call")).toContain("contractId");
		expect(byType.get("contract_call")).not.toContain("contract");
		// print_event drops the unsupported `contains`
		expect(byType.get("print_event")).not.toContain("contains");
		// NFT filters drop the unsupported `tokenId`
		expect(byType.get("nft_transfer")).not.toContain("tokenId");
	});
});

// The golden-path tool surface (STRATEGY.md: the MCP server is a distribution
// channel exposing golden-path tools only; the periphery lives behind REST /v1
// + OpenAPI). Adding or removing a tool must update this list deliberately.
const GOLDEN_PATH_TOOLS = [
	// account
	"account_create_key",
	"account_whoami",
	// index reads
	"batch_query",
	"index_blocks",
	"index_contract_calls",
	"index_discover",
	"index_events",
	"index_ft_transfers",
	"index_nft_transfers",
	"index_print_schema",
	"index_transactions",
	// contracts / scaffold
	"contracts_find",
	"get_contract_abi",
	"scaffold_from_contract",
	// streams
	"streams_dumps",
	// subgraphs lifecycle
	"subgraphs_backfill",
	"subgraphs_delete",
	"subgraphs_deploy",
	"subgraphs_gaps",
	"subgraphs_get",
	"subgraphs_list",
	"subgraphs_publish",
	"subgraphs_query",
	"subgraphs_reindex",
	"subgraphs_stop",
	"subgraphs_unpublish",
	// subscriptions
	"subscriptions_create",
	"subscriptions_delete",
	"subscriptions_get",
	"subscriptions_list",
	"subscriptions_replay",
	"subscriptions_test",
	"subscriptions_update",
];

describe("capabilities ↔ tool registry", () => {
	// Guards against CAPABILITIES drifting behind the tool surface: every tool
	// registered via defineTool must appear in the generated capability list. If
	// this fails, a tool was added but buildCapabilities couldn't place it (e.g.
	// an unknown product prefix) — fix the generator, don't hand-edit a list.
	it("lists every registered tool", () => {
		const names = getRegisteredToolNames();
		expect(names.length).toBeGreaterThan(0);
		const listed = buildCapabilities().products.join(" ");
		const missing = names.filter((n) => !listed.includes(n));
		expect(missing).toEqual([]);
	});

	it("registers exactly the golden-path tool set", () => {
		expect([...getRegisteredToolNames()].sort()).toEqual(
			[...GOLDEN_PATH_TOOLS].sort(),
		);
	});
});

describe("discovery resources", () => {
	it("registers the traits and chain-triggers resources", async () => {
		const resources = captureResources();
		const uris = resources.map((r) => r.uri);
		expect(uris).toContain("secondlayer://traits");
		expect(uris).toContain("secondlayer://chain-triggers");
		// streams-filters was removed with the live Streams tools (golden-path prune)
		expect(uris).not.toContain("secondlayer://streams-filters");
	});

	it("traits resource lists the SIP standards", async () => {
		const traits = captureResources().find(
			(r) => r.uri === "secondlayer://traits",
		);
		const text = (await traits?.read())?.contents[0]?.text ?? "";
		expect(text).toContain("sip-010");
		expect(text).toContain("sip-009");
		expect(text).toContain("sip-013");
	});
});
