import { z } from "zod";

export type ColumnType = "text" | "uint" | "int" | "principal" | "boolean" | "timestamp" | "jsonb";

export interface ViewColumn {
  type: ColumnType;
  nullable?: boolean;
  indexed?: boolean;
  default?: string | number | boolean;
}

export interface ViewTable {
  columns: Record<string, ViewColumn>;
  indexes?: string[][];
  uniqueKeys?: string[][];
}

export interface ViewSource {
  contract?: string;
  event?: string;
  function?: string;
  type?: string;
  minAmount?: bigint;
}

export interface ViewDefinition {
  name: string;
  version?: string;
  description?: string;
  sources: ViewSource[];
  schema: Record<string, ViewTable>;
  handlers: Record<string, (...args: unknown[]) => unknown>;
}

export const ViewNameSchema: z.ZodType<string> = z
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

export const ViewColumnSchema: z.ZodType<ViewColumn> = z.object({
  type: ColumnTypeSchema,
  nullable: z.boolean().optional(),
  indexed: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
}) as z.ZodType<ViewColumn>;

export const ViewTableSchema: z.ZodType<ViewTable> = z.object({
  columns: z
    .record(z.string(), ViewColumnSchema)
    .refine((c) => Object.keys(c).length > 0, "Table must have at least one column"),
  indexes: z.array(z.array(z.string())).optional(),
  uniqueKeys: z.array(z.array(z.string())).optional(),
}) as z.ZodType<ViewTable>;

export const ViewSchemaSchema: z.ZodType<Record<string, ViewTable>> = z
  .record(z.string(), ViewTableSchema)
  .refine((s) => Object.keys(s).length > 0, "Schema must have at least one table") as z.ZodType<Record<string, ViewTable>>;

export const ViewSourceSchema: z.ZodType<ViewSource> = z
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
  ) as z.ZodType<ViewSource>;

export const ViewDefinitionSchema: z.ZodType<ViewDefinition> = z.object({
  name: ViewNameSchema,
  version: z.string().optional(),
  description: z.string().optional(),
  sources: z.array(ViewSourceSchema).min(1, "Must have at least one source"),
  schema: ViewSchemaSchema,
  handlers: z.record(z.string(), z.function()),
}) as z.ZodType<ViewDefinition>;

/**
 * Validates a view definition, returning the parsed result or throwing on failure.
 */
export function validateViewDefinition(def: unknown): ViewDefinition {
  return ViewDefinitionSchema.parse(def);
}
