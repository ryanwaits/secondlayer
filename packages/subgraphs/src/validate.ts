import { z } from "zod";
import type {
	ColumnType,
	SubgraphColumn,
	SubgraphDefinition,
	SubgraphFilter,
	SubgraphTable,
} from "./types.ts";

export const SubgraphNameSchema: z.ZodType<string> = z
	.string()
	.min(1)
	.max(63)
	.regex(
		/^[a-z][a-z0-9-]*$/,
		"Must start with lowercase letter, contain only lowercase alphanumeric and hyphens",
	);

/**
 * A safe SQL identifier (table or column name). Mirrors the runtime guard in
 * runtime/context.ts (validateColumnName) so the schema validator can never
 * accept a name the runtime would reject — and closes the deploy-time DDL
 * injection path in schema/generator.ts, which interpolates these names raw.
 */
export const SqlIdentifierSchema: z.ZodType<string> = z
	.string()
	.min(1)
	.max(63) // Postgres truncates identifiers > 63 bytes; reject rather than collide.
	.regex(
		/^[a-z_][a-z0-9_]*$/i,
		"Must be a valid SQL identifier: start with a letter or underscore, then letters/digits/underscores only",
	);

export const ColumnTypeSchema: z.ZodType<ColumnType> = z.enum([
	"text",
	"uint",
	"int",
	"principal",
	"boolean",
	"timestamp",
	"jsonb",
]);

/**
 * One declared print field: a bare column type, or a composite (optional,
 * nested tuple, list). Recursive — real print payloads nest, and a vocabulary
 * that could only say `"jsonb"` is what let a flat-field declaration pass
 * while every event decoded to null.
 */
export const PrintFieldSchema: z.ZodType<unknown> = z.lazy(() =>
	z.union([
		ColumnTypeSchema,
		z.object({ type: PrintFieldSchema, optional: z.literal(true) }),
		z.object({ tuple: z.record(z.string(), PrintFieldSchema) }),
		z.object({ list: PrintFieldSchema }),
	]),
);

/**
 * A Clarity ABI type: a primitive name, or one of the composite shapes.
 * Recursive, so nested tuples/lists/optionals are checked all the way down.
 */
const AbiTypeSchema: z.ZodType<unknown> = z.lazy(() =>
	z.union([
		z.string(),
		z.object({ buff: z.object({ length: z.number() }) }),
		z.object({ "string-ascii": z.object({ length: z.number() }) }),
		z.object({ "string-utf8": z.object({ length: z.number() }) }),
		z.object({ optional: AbiTypeSchema }),
		z.object({
			list: z.object({ type: AbiTypeSchema, length: z.number() }),
		}),
		z.object({
			tuple: z.array(z.object({ name: z.string(), type: AbiTypeSchema })),
		}),
		z.object({
			response: z.object({ ok: AbiTypeSchema, error: AbiTypeSchema }),
		}),
	]),
);

/**
 * The canonical `AbiContract` shape, validated at deploy time.
 *
 * This used to be `z.record(z.string(), z.any())`, which accepted a raw
 * Hiro/Clarinet ABI (`read_only` access, `buffer` types, outputs wrapped as
 * `{ type: … }`) and let it through — the deploy succeeded and `event.input`
 * then mis-decoded at RUNTIME, per event, forever. Reject it here instead,
 * and name the fix: run it through `normalizeAbi` from
 * `@secondlayer/stacks/clarity`.
 */
export const AbiContractSchema: z.ZodType<unknown> = z.object({
	functions: z.array(
		z.object({
			name: z.string(),
			access: z.enum(["public", "read-only", "private"], {
				message:
					"ABI access must be public | read-only | private — a raw Hiro/Clarinet ABI uses `read_only`. Normalize it first: normalizeAbi() from @secondlayer/stacks/clarity.",
			}),
			args: z.array(z.object({ name: z.string(), type: AbiTypeSchema })),
			// Canonical shape is a bare AbiType; raw ABIs wrap it as `{ type: … }`.
			outputs: AbiTypeSchema,
		}),
	),
	maps: z.array(z.unknown()).optional(),
	variables: z.array(z.unknown()).optional(),
	fungible_tokens: z.array(z.unknown()).optional(),
	non_fungible_tokens: z.array(z.unknown()).optional(),
	implemented_traits: z.array(z.unknown()).optional(),
	defined_traits: z.array(z.unknown()).optional(),
});

export const SubgraphColumnSchema: z.ZodType<SubgraphColumn> = z.object({
	type: ColumnTypeSchema,
	nullable: z.boolean().optional(),
	indexed: z.boolean().optional(),
	search: z.boolean().optional(),
	default: z.union([z.string(), z.number(), z.boolean()]).optional(),
}) as z.ZodType<SubgraphColumn>;

export const SubgraphTableSchema: z.ZodType<SubgraphTable> = z.object({
	columns: z
		.record(SqlIdentifierSchema, SubgraphColumnSchema)
		.refine(
			(c) => Object.keys(c).length > 0,
			"Table must have at least one column",
		),
	indexes: z.array(z.array(SqlIdentifierSchema)).optional(),
	uniqueKeys: z.array(z.array(SqlIdentifierSchema)).optional(),
	relations: z
		.array(
			z.object({
				name: SqlIdentifierSchema,
				references: SqlIdentifierSchema,
				fields: z.array(SqlIdentifierSchema).min(1),
				referencedColumns: z.array(SqlIdentifierSchema).min(1),
			}),
		)
		.optional(),
}) as z.ZodType<SubgraphTable>;

export const SubgraphSchemaSchema: z.ZodType<Record<string, SubgraphTable>> = z
	.record(SqlIdentifierSchema, SubgraphTableSchema)
	.refine(
		(s) => Object.keys(s).length > 0,
		"Schema must have at least one table",
	) as z.ZodType<Record<string, SubgraphTable>>;

export const VALID_FILTER_TYPES = [
	"stx_transfer",
	"stx_mint",
	"stx_burn",
	"stx_lock",
	"ft_transfer",
	"ft_mint",
	"ft_burn",
	"nft_transfer",
	"nft_mint",
	"nft_burn",
	"contract_call",
	"contract_deploy",
	"print_event",
] as const;

/** A contract id, or a set of them (max 20, matching the Index API cap). */
const contractIdField = z.union([
	z.string(),
	z.array(z.string()).min(1).max(20),
]);

/** Fields shared by the trait-scopable filters. */
const traitScope = { trait: z.string().optional() };
/** Dynamic address set discovered from another source's events. */
const factoryScope = {
	factory: z
		.object({ from: z.string().min(1), field: z.string().min(1) })
		.strict()
		.optional(),
};
const amountRange = {
	minAmount: z.bigint().optional(),
	maxAmount: z.bigint().optional(),
};

/**
 * A REAL discriminated union — one member per source type, each `.strict()`
 * with only the fields that type actually supports.
 *
 * It used to be one flat object with every field optional, so
 * `{ type: "contract_deploy", assetIdentifier: "SP…", minAmount: 1n }`
 * validated clean at deploy and then matched nothing, forever. The runtime
 * union already knew better; only the validator didn't.
 */
const SubgraphFilterUnion = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("stx_transfer"),
			sender: z.string().optional(),
			recipient: z.string().optional(),
			...amountRange,
		})
		.strict(),
	z
		.object({
			type: z.literal("stx_mint"),
			recipient: z.string().optional(),
			minAmount: z.bigint().optional(),
		})
		.strict(),
	z
		.object({
			type: z.literal("stx_burn"),
			sender: z.string().optional(),
			minAmount: z.bigint().optional(),
		})
		.strict(),
	z
		.object({
			type: z.literal("stx_lock"),
			lockedAddress: z.string().optional(),
			minAmount: z.bigint().optional(),
		})
		.strict(),
	z
		.object({
			type: z.literal("ft_transfer"),
			assetIdentifier: z.string().optional(),
			sender: z.string().optional(),
			recipient: z.string().optional(),
			minAmount: z.bigint().optional(),
			...traitScope,
		})
		.strict(),
	z
		.object({
			type: z.literal("ft_mint"),
			assetIdentifier: z.string().optional(),
			recipient: z.string().optional(),
			minAmount: z.bigint().optional(),
			...traitScope,
		})
		.strict(),
	z
		.object({
			type: z.literal("ft_burn"),
			assetIdentifier: z.string().optional(),
			sender: z.string().optional(),
			minAmount: z.bigint().optional(),
			...traitScope,
		})
		.strict(),
	z
		.object({
			type: z.literal("nft_transfer"),
			assetIdentifier: z.string().optional(),
			sender: z.string().optional(),
			recipient: z.string().optional(),
			...traitScope,
		})
		.strict(),
	z
		.object({
			type: z.literal("nft_mint"),
			assetIdentifier: z.string().optional(),
			recipient: z.string().optional(),
			...traitScope,
		})
		.strict(),
	z
		.object({
			type: z.literal("nft_burn"),
			assetIdentifier: z.string().optional(),
			sender: z.string().optional(),
			...traitScope,
		})
		.strict(),
	z
		.object({
			type: z.literal("contract_call"),
			contractId: contractIdField.optional(),
			functionName: z.string().optional(),
			caller: z.string().optional(),
			abi: AbiContractSchema.optional(),
			...traitScope,
			...factoryScope,
		})
		.strict(),
	z
		.object({
			type: z.literal("contract_deploy"),
			deployer: z.string().optional(),
			contractName: z.string().optional(),
		})
		.strict(),
	z
		.object({
			type: z.literal("print_event"),
			contractId: contractIdField.optional(),
			topic: z.string().optional(),
			prints: z
				.record(z.string(), z.record(z.string(), PrintFieldSchema))
				.optional(),
			...traitScope,
			...factoryScope,
		})
		.strict(),
]);

/**
 * `trait` and `contractId` compose rather than conflict: the matcher ANDs
 * them, so the pair means "contracts conforming to this trait, narrowed to
 * these ids". (The Index READ API refuses the combination because its query
 * planner picks one index path — that's an API constraint, not a semantic
 * one, and subgraph sources are not bound by it.)
 */
export const SubgraphFilterSchema: z.ZodType<SubgraphFilter> =
	SubgraphFilterUnion as unknown as z.ZodType<SubgraphFilter>;

export const SubgraphDefinitionSchema: z.ZodType<SubgraphDefinition> = z.object(
	{
		name: SubgraphNameSchema,
		version: z.string().optional(),
		description: z.string().optional(),
		startBlock: z.number().int().nonnegative().optional(),
		// 'concurrent' = tip-first deploy: go live at tip immediately, fill
		// history via a background backfill. Only safe for order-tolerant
		// handlers (commutative or insert-only writes).
		backfillMode: z.enum(["blocking", "concurrent"]).optional(),
		sources: z
			.record(z.string(), SubgraphFilterSchema)
			.refine(
				(s) => Object.keys(s).length > 0,
				"Must have at least one source",
			),
		schema: SubgraphSchemaSchema,
		handlers: z.record(z.string(), z.any()),
	},
) as unknown as z.ZodType<SubgraphDefinition>;

/**
 * Validates a subgraph definition, returning the parsed result or throwing on failure.
 */
export function validateSubgraphDefinition(def: unknown): SubgraphDefinition {
	return SubgraphDefinitionSchema.parse(def);
}

/**
 * Per-source-type field vocabulary, DERIVED from
 * {@link SubgraphFilterSchema}. Agent-facing surfaces (the MCP filters
 * reference) used to hand-maintain a parallel copy of this list; deriving it
 * means adding a field to a filter can never leave the documentation behind.
 */
export function filterFieldsByType(): Array<{
	type: string;
	fields: string[];
}> {
	// Read the UNION directly (SubgraphFilterSchema wraps it in superRefine).
	// biome-ignore lint/suspicious/noExplicitAny: reading zod's internal option shapes
	const options = (SubgraphFilterUnion as any)?._def?.options ?? [];
	const out: Array<{ type: string; fields: string[] }> = [];
	for (const option of options) {
		// `.superRefine()` wraps the union, so unwrap one level when present.
		const shape = option?.shape ?? option?._def?.shape;
		if (!shape) continue;
		const literal =
			shape.type?._def?.values?.[0] ?? shape.type?._def?.value ?? undefined;
		if (typeof literal !== "string") continue;
		out.push({
			type: literal,
			fields: Object.keys(shape).filter((k) => k !== "type"),
		});
	}
	return out;
}
