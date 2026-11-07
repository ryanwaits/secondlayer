import { z } from "zod";

/**
 * Identifiers an agent hands a tool end up as URL path segments. Each is
 * checked against the shape the API itself issues, so `.`, `..`, `/`, `?` and
 * the empty string never reach the SDK (which refuses them too).
 */

/** A webhook, outbox row or delivery id: a UUID. */
export const uuidSchema: z.ZodString = z.string().uuid();

/** Webhook id. */
export const webhookIdSchema: z.ZodString = uuidSchema.describe("Webhook id");

/** Subgraph name: lowercase alphanumerics and hyphens, 63 chars at most
 *  (the deploy schema, `DeploySubgraphRequestSchema`). */
export const subgraphNameSchema: z.ZodString = z
	.string()
	.min(1)
	.max(63)
	.regex(/^[a-z0-9-]+$/, "lowercase alphanumeric + hyphens only")
	.describe("Subgraph name");

/** Subgraph table name: a SQL identifier (`SqlIdentifierSchema`). */
export const tableNameSchema: z.ZodString = z
	.string()
	.min(1)
	.max(63)
	.regex(/^[a-z_][a-z0-9_]*$/i, "letters, digits and underscores only")
	.describe("Table name");
