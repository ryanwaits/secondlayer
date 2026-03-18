import { z } from "zod";
import type { ColumnType, SubgraphColumn, SubgraphTable, SubgraphSource, SubgraphDefinition } from "./types.ts";

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
    .refine((c) => Object.keys(c).length > 0, "Table must have at least one column"),
  indexes: z.array(z.array(z.string())).optional(),
  uniqueKeys: z.array(z.array(z.string())).optional(),
}) as z.ZodType<SubgraphTable>;

export const SubgraphSchemaSchema: z.ZodType<Record<string, SubgraphTable>> = z
  .record(z.string(), SubgraphTableSchema)
  .refine((s) => Object.keys(s).length > 0, "Schema must have at least one table") as z.ZodType<Record<string, SubgraphTable>>;

export const SubgraphSourceSchema: z.ZodType<SubgraphSource> = z
  .object({
    contract: z.string().optional(),
    event: z.string().optional(),
    function: z.string().optional(),
    type: z.string().optional(),
    minAmount: z.bigint().optional(),
  })
  .refine(
    (s) => s.contract || s.type,
    "Source must specify at least 'contract' or 'type'",
  ) as z.ZodType<SubgraphSource>;

export const SubgraphDefinitionSchema: z.ZodType<SubgraphDefinition> = z.object({
  name: SubgraphNameSchema,
  version: z.string().optional(),
  description: z.string().optional(),
  sources: z.array(SubgraphSourceSchema).min(1, "Must have at least one source"),
  schema: SubgraphSchemaSchema,
  handlers: z.record(z.string(), z.function()),
}) as unknown as z.ZodType<SubgraphDefinition>;

/**
 * Validates a subgraph definition, returning the parsed result or throwing on failure.
 */
export function validateSubgraphDefinition(def: unknown): SubgraphDefinition {
  return SubgraphDefinitionSchema.parse(def);
}
