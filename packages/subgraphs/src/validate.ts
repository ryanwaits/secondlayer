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

export const SubgraphFilterSchema: z.ZodType<SubgraphFilter> = z
	.object({
		type: z.enum(VALID_FILTER_TYPES),
		// All optional fields across all filter types
		sender: z.string().optional(),
		recipient: z.string().optional(),
		minAmount: z.bigint().optional(),
		maxAmount: z.bigint().optional(),
		assetIdentifier: z.string().optional(),
		contractId: z.string().optional(),
		functionName: z.string().optional(),
		caller: z.string().optional(),
		deployer: z.string().optional(),
		contractName: z.string().optional(),
		topic: z.string().optional(),
		lockedAddress: z.string().optional(),
		abi: AbiContractSchema.optional(),
		trait: z.string().optional(),
		// print_event per-topic field schema. Declaring it opts the source into
		// runtime payload validation (skip + log on mismatch).
		prints: z
			.record(z.string(), z.record(z.string(), PrintFieldSchema))
			.optional(),
	})
	.strict() as unknown as z.ZodType<SubgraphFilter>;

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
