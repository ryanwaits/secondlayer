// Re-export canonical pgSchemaName from shared
export { pgSchemaName } from "@secondlayer/shared/db/queries/subgraphs";

/**
 * Double-quotes a Postgres identifier unless it's already a safe bare
 * identifier, escaping any embedded double quotes. Defense-in-depth for the
 * DDL emitters: every name reaching them (schema/table/column names, and the
 * composite names generator.ts builds from them) is validated upstream
 * (`SqlIdentifierSchema` / `SubgraphNameSchema`), so this is a no-op for every
 * currently-valid name — output stays byte-identical. It only changes
 * anything if a hostile name (embedded quote, semicolon, whitespace, ...)
 * somehow reached this far, turning it into an inert quoted identifier
 * instead of raw SQL.
 */
export function quotePgIdent(name: string): string {
	if (/^[a-z_][a-z0-9_]*$/i.test(name)) return name;
	return `"${name.replace(/"/g, '""')}"`;
}

/** `user_account` → `userAccount`. Column and variable names in every emitted
 *  ORM surface go through this. */
export function snakeToCamel(name: string): string {
	return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** `user_account` → `UserAccount`. Type/model names for one table must agree
 *  across the Prisma, Drizzle, Kysely, and index-codegen emitters — a user can
 *  import from more than one, so this lives here rather than per-generator. */
export function pascalCase(name: string): string {
	const camel = snakeToCamel(name);
	return camel.charAt(0).toUpperCase() + camel.slice(1);
}
