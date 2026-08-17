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
				account: { email: "a@b.com" },
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
				activeOperations: [],
			}),
		} as unknown as Client;

		const ctx = await buildContext({ clientProvider: () => client });

		expect(Array.isArray(ctx.whatExists.subgraphs)).toBe(true);
		expect(ctx.whatExists.subscriptions).toEqual({
			count: 2,
			byStatus: { active: 1, paused: 1 },
		});
		expect(ctx.whatExists.account).toEqual({ email: "a@b.com" });
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
				activeOperations: null,
			}),
		} as unknown as Client;

		const ctx = await buildContext({ clientProvider: () => client });

		expect(ctx.whatExists.subgraphs).toEqual([]);
		expect(ctx.whatExists.subscriptions).toBe("unavailable: set SL_API_KEY");
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
	// The reference is now DERIVED from the validator, so instead of reading
	// zod internals we prove the round trip: every advertised field must be
	// accepted on its own type by the real schema.

	/** A value the schema will accept for a given field name. */
	function sampleValue(field: string): unknown {
		switch (field) {
			case "minAmount":
			case "maxAmount":
				return 1n;
			case "abi":
				return { functions: [] };
			case "prints":
				return { topic: { field: "uint" } };
			case "factory":
				return { from: "other", field: "data.pool" };
			case "contractId":
				return "SP1.contract";
			default:
				return "SP1";
		}
	}

	it("serves exactly the validator's filter types", () => {
		const served = FILTERS_REFERENCE.map((f) => f.type).sort();
		expect(served).toEqual([...VALID_FILTER_TYPES].sort());
	});

	it("never advertises a field the validator rejects", () => {
		for (const filter of FILTERS_REFERENCE) {
			for (const field of filter.fields) {
				const candidate = { type: filter.type, [field]: sampleValue(field) };
				const parsed = SubgraphFilterSchema.safeParse(candidate);
				expect(
					parsed.success,
					`${filter.type}.${field}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`,
				).toBe(true);
			}
		}
	});

	it("a field from ANOTHER type is rejected (the union is strict)", () => {
		// contract_deploy has no assetIdentifier — this used to validate clean
		// under the old flat schema and then match nothing forever.
		expect(
			SubgraphFilterSchema.safeParse({
				type: "contract_deploy",
				assetIdentifier: "SP1.t::t",
			}).success,
		).toBe(false);
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
	// index reads
	"batch_query",
	"codegen_index_schema",
	"index_blocks",
	"index_contract_calls",
	"index_discover",
	"index_events",
	"index_ft_transfers",
	"index_nft_transfers",
	"index_print_schema",
	"index_transactions",
	// contracts
	"contracts_find",
	"contracts_get_abi",
	// streams
	"streams_block_events",
	"streams_canonical",
	"streams_dumps",
	"streams_events",
	"streams_events_by_tx",
	"streams_reorgs",
	"streams_tip",
	// subgraphs lifecycle
	"subgraphs_backfill",
	"subgraphs_delete",
	"subgraphs_deploy",
	"subgraphs_gaps",
	"subgraphs_status",
	"subgraphs_list",
	"subgraphs_operations",
	"subgraphs_query",
	"subgraphs_reindex",
	"subgraphs_scaffold",
	"subgraphs_spec",
	"subgraphs_stop",
	// subscriptions
	"subscriptions_create",
	"subscriptions_dead",
	"subscriptions_deliveries",
	"subscriptions_delete",
	"subscriptions_get",
	"subscriptions_list",
	"subscriptions_pause",
	"subscriptions_replay",
	"subscriptions_requeue",
	"subscriptions_resume",
	"subscriptions_rotate_secret",
	"subscriptions_test",
	"subscriptions_update",
	// account
	"account_create_key",
	"account_whoami",
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
