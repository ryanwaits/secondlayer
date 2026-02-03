import { z } from "zod";

export const ViewNameSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(
    /^[a-z][a-z0-9-]*$/,
    "Must start with lowercase letter, contain only lowercase alphanumeric and hyphens",
  );

export const ColumnTypeSchema = z.enum([
  "text",
  "uint",
  "int",
  "principal",
  "boolean",
  "timestamp",
  "jsonb",
]);

export const ViewColumnSchema = z.object({
  type: ColumnTypeSchema,
  nullable: z.boolean().optional(),
  indexed: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const ViewTableSchema = z.object({
  columns: z
    .record(z.string(), ViewColumnSchema)
    .refine((c) => Object.keys(c).length > 0, "Table must have at least one column"),
  indexes: z.array(z.array(z.string())).optional(),
  uniqueKeys: z.array(z.array(z.string())).optional(),
});

export const ViewSchemaSchema = z
  .record(z.string(), ViewTableSchema)
  .refine((s) => Object.keys(s).length > 0, "Schema must have at least one table");

export const ViewSourceSchema = z
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
  );

export const ViewDefinitionSchema = z.object({
  name: ViewNameSchema,
  version: z.string().optional(),
  description: z.string().optional(),
  sources: z.array(ViewSourceSchema).min(1, "Must have at least one source"),
  schema: ViewSchemaSchema,
  handlers: z.record(z.string(), z.function()),
});

/**
 * Validates a view definition, returning the parsed result or throwing on failure.
 */
export function validateViewDefinition(def: unknown): z.infer<typeof ViewDefinitionSchema> {
  return ViewDefinitionSchema.parse(def);
}
