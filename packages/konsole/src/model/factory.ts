import type { Kysely } from "kysely";
import { QueryChain, wrapChain } from "./query-chain.ts";
import { Record } from "./record.ts";
import type { Row, Model, ModelRegistry } from "./types.ts";
import type { SchemaInfo } from "../schema/types.ts";
import type { AssociationMap, AssociationDef } from "../schema/associations.ts";
import { tableToModelName } from "../schema/naming.ts";

/** PascalCase/camelCase → snake_case: "EmailAddress" → "email_address" */
function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c, i) => (i === 0 ? "" : "_") + c.toLowerCase());
}

/**
 * Parse findByEmailAndName → ["email", "name"]
 * Returns null if prop doesn't match findBy<Attr> pattern
 */
function parseDynamicFinder(prop: string): string[] | null {
  const match = prop.match(/^findBy([A-Z]\w*)$/);
  if (!match) return null;
  return match[1].split("And").map(camelToSnake);
}

function createModel(
  db: Kysely<any>,
  table: string,
  primaryKey: string,
  columns: string[],
  associations: AssociationDef[],
  registry: ModelRegistry,
): Model {
  const base = () => wrapChain(
    new QueryChain(db, table, primaryKey, columns, associations, registry),
  );

  const model: Model = {
    _table: table,
    _primaryKey: primaryKey,
    _columns: columns,

    get all() { return base(); },
    get first() { return base().first; },
    get last() { return base().last; },
    get count() { return base().count; },

    where(columnOrConditions: string | Row, value?: unknown) {
      return base().where(columnOrConditions, value);
    },
    not(conditions: Row) {
      return base().not(conditions);
    },
    find(id: string | number) {
      return base().where({ [primaryKey]: id }).first as unknown as Promise<Record | null>;
    },
    findBy(conditions: Row) {
      return base().where(conditions).first as unknown as Promise<Record | null>;
    },
    pluck(column: string) {
      return base().pluck(column);
    },
    async create(attrs: Row) {
      const row = await db
        .insertInto(table)
        .values(attrs as any)
        .returningAll()
        .executeTakeFirstOrThrow();
      return new Record(db, table, primaryKey, columns, associations, registry, row as Row);
    },
    order(column: string, direction: "asc" | "desc" = "asc") {
      return base().order(column, direction);
    },
    limit(n: number) {
      return base().limit(n);
    },
    joins(...names: string[]) {
      return base().joins(...names);
    },
    leftJoins(...names: string[]) {
      return base().leftJoins(...names);
    },
    async exists(conditions?: Row) {
      const chain = conditions ? base().where(conditions) : base();
      return chain.exists;
    },
  };

  // Proxy for dynamic finders: findByEmail("x"), findByPlanAndEmail("pro", "x")
  const columnSet = new Set(columns);
  return new Proxy(model, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") return Reflect.get(target, prop, receiver);
      const attrs = parseDynamicFinder(prop);
      if (!attrs) return Reflect.get(target, prop, receiver);
      // Validate all attrs are real columns
      if (!attrs.every((a) => columnSet.has(a))) return Reflect.get(target, prop, receiver);
      return (...args: unknown[]) => {
        const conditions: Row = {};
        for (let i = 0; i < attrs.length; i++) {
          conditions[attrs[i]] = args[i];
        }
        return target.findBy(conditions);
      };
    },
  });
}

export function createModelsFromSchema(
  db: Kysely<any>,
  schema: SchemaInfo,
  associationMap: AssociationMap,
): ModelRegistry {
  const registry: ModelRegistry = {};

  for (const [tableName, tableInfo] of schema.tables) {
    const modelName = tableToModelName(tableName);
    const columns = tableInfo.columns.map((c) => c.name);
    const associations = associationMap[tableName] ?? [];
    registry[modelName] = createModel(
      db, tableName, tableInfo.primaryKey, columns, associations, registry,
    );
  }

  return registry;
}
