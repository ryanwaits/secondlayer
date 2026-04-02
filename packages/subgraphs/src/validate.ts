import { z } from "zod/v4";
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

export const ColumnTypeSchema: z.ZodType<ColumnType> = z.enum([
	"text",
	"uint",
	"int",
	"principal",
	"boolean",
	"timestamp",
	"jsonb",
]);

export const SubgraphColumnSchema: z.ZodType<SubgraphColumn> = z.object({
	type: ColumnTypeSchema,
	nullable: z.boolean().optional(),
	indexed: z.boolean().optional(),
	search: z.boolean().optional(),
	default: z.union([z.string(), z.number(), z.boolean()]).optional(),
}) as z.ZodType<SubgraphColumn>;

export const SubgraphTableSchema: z.ZodType<SubgraphTable> = z.object({
	columns: z
		.record(z.string(), SubgraphColumnSchema)
		.refine(
			(c) => Object.keys(c).length > 0,
			"Table must have at least one column",
		),
	indexes: z.array(z.array(z.string())).optional(),
	uniqueKeys: z.array(z.array(z.string())).optional(),
}) as z.ZodType<SubgraphTable>;

export const SubgraphSchemaSchema: z.ZodType<Record<string, SubgraphTable>> = z
	.record(z.string(), SubgraphTableSchema)
	.refine(
		(s) => Object.keys(s).length > 0,
		"Schema must have at least one table",
	) as z.ZodType<Record<string, SubgraphTable>>;

const VALID_FILTER_TYPES = [
	"stx_transfer", "stx_mint", "stx_burn", "stx_lock",
	"ft_transfer", "ft_mint", "ft_burn",
	"nft_transfer", "nft_mint", "nft_burn",
	"contract_call", "contract_deploy", "print_event",
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
		abi: z.record(z.string(), z.any()).optional(),
	})
	.passthrough() as unknown as z.ZodType<SubgraphFilter>;

export const SubgraphDefinitionSchema: z.ZodType<SubgraphDefinition> = z.object(
	{
		name: SubgraphNameSchema,
		version: z.string().optional(),
		description: z.string().optional(),
		startBlock: z.number().int().nonnegative().optional(),
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
