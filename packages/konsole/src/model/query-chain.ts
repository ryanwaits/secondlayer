import { sql, type Kysely } from "kysely";
import { Record } from "./record.ts";
import type { Row, ModelRegistry } from "./types.ts";
import type { AssociationDef } from "../schema/associations.ts";

// Known properties on QueryChain (don't intercept these)
const CHAIN_PROPS = new Set([
  "where", "not", "order", "limit", "offset", "joins", "leftJoins", "distinct",
  "first", "last", "count", "size", "length", "exists", "pluck", "update", "destroy",
  "toSql", "then", "constructor", "prototype",
  // private
  "_db", "_table", "_primaryKey", "_columns", "_associations", "_registry",
  "_wheres", "_orderBys", "_limitN", "_offsetN", "_joins", "_distinct",
  "_single", "_clone", "_applyWheres", "_applyJoins", "_execute",
  "_firstN", "_lastN",
]);

// Properties that act as both getter (no args) and method (with n)
const HYBRID_PROPS = new Set(["first", "last"]);

// Proxy wrapper: makes `chain.email` resolve to the attribute
export function wrapChain(chain: QueryChain): QueryChain {
  return new Proxy(chain, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol") {
        return Reflect.get(target, prop, receiver);
      }

      // first/last: callable(n) for N records, thenable for single record
      if (HYBRID_PROPS.has(prop)) {
        const singleChain = Reflect.get(target, prop, receiver) as QueryChain;
        const wrapped = wrapChain(singleChain);
        const methodName = prop === "first" ? "_firstN" : "_lastN";
        const hybrid = (n?: number) => {
          if (n !== undefined) return wrapChain(target[methodName](n));
          return wrapped;
        };
        (hybrid as any).then = (resolve: any, reject: any) => wrapped.then(resolve, reject);
        (hybrid as any)[Symbol.for("nodejs.util.inspect.custom")] = () =>
          (singleChain as any)[Symbol.for("nodejs.util.inspect.custom")]();
        return hybrid;
      }

      if (CHAIN_PROPS.has(prop) || prop.startsWith("_")) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === "function") {
          return (...args: any[]) => {
            const result = value.apply(target, args);
            return result instanceof QueryChain ? wrapChain(result) : result;
          };
        }
        if (value instanceof QueryChain) return wrapChain(value);
        return value;
      }

      // Unknown property → attribute projection
      const attrName = prop as string;
      return {
        then(resolve: any, reject: any) {
          return target._execute().then(
            (result: any) => {
              if (result === null || result === undefined) return resolve(null);
              if (Array.isArray(result)) {
                return resolve(result.map((r: any) =>
                  r instanceof Record ? r.attributes[attrName] : r[attrName],
                ));
              }
              if (result instanceof Record) return resolve(result.attributes[attrName]);
              return resolve(result[attrName]);
            },
            reject,
          );
        },
        [Symbol.for("nodejs.util.inspect.custom")]() {
          return `<awaiting .${attrName}>`;
        },
      };
    },
  });
}

export class QueryChain {
  _db: Kysely<any>;
  _table: string;
  _primaryKey: string;
  _columns: string[];
  _associations: AssociationDef[];
  _registry: ModelRegistry;
  _wheres: [string, string, unknown][] = [];
  _orderBys: [string, "asc" | "desc"][] = [];
  _joins: { table: string; type: "inner" | "left"; on: [string, string] }[] = [];
  _limitN?: number;
  _offsetN?: number;
  _single = false;
  _distinct = false;

  constructor(
    db: Kysely<any>,
    table: string,
    primaryKey: string,
    columns: string[],
    associations: AssociationDef[],
    registry: ModelRegistry,
  ) {
    this._db = db;
    this._table = table;
    this._primaryKey = primaryKey;
    this._columns = columns;
    this._associations = associations;
    this._registry = registry;
  }

  _clone(): QueryChain {
    const q = new QueryChain(
      this._db, this._table, this._primaryKey,
      this._columns, this._associations, this._registry,
    );
    q._wheres = [...this._wheres];
    q._orderBys = [...this._orderBys];
    q._joins = [...this._joins];
    q._limitN = this._limitN;
    q._offsetN = this._offsetN;
    q._single = this._single;
    q._distinct = this._distinct;
    return q;
  }

  // Chainable query methods

  where(columnOrConditions: string | Row, value?: unknown): QueryChain {
    const q = this._clone();
    const conditions = typeof columnOrConditions === "string"
      ? { [columnOrConditions]: value }
      : columnOrConditions;

    for (const [k, v] of Object.entries(conditions)) {
      if (v === null) {
        q._wheres.push([k, "is", null]);
      } else if (Array.isArray(v)) {
        q._wheres.push([k, "in", v]);
      } else {
        q._wheres.push([k, "=", v]);
      }
    }
    return q;
  }

  not(conditions: Row): QueryChain {
    const q = this._clone();
    for (const [k, v] of Object.entries(conditions)) {
      if (v === null) {
        q._wheres.push([k, "is not", null]);
      } else {
        q._wheres.push([k, "!=", v]);
      }
    }
    return q;
  }

  order(column: string, direction: "asc" | "desc" = "asc"): QueryChain {
    const q = this._clone();
    q._orderBys.push([column, direction]);
    return q;
  }

  limit(n: number): QueryChain {
    const q = this._clone();
    q._limitN = n;
    return q;
  }

  offset(n: number): QueryChain {
    const q = this._clone();
    q._offsetN = n;
    return q;
  }

  joins(...names: string[]): QueryChain {
    const q = this._clone();
    for (const name of names) {
      q._addJoin(name, "inner");
    }
    return q;
  }

  leftJoins(...names: string[]): QueryChain {
    const q = this._clone();
    for (const name of names) {
      q._addJoin(name, "left");
    }
    return q;
  }

  get distinct(): QueryChain {
    const q = this._clone();
    q._distinct = true;
    return q;
  }

  private _addJoin(name: string, type: "inner" | "left") {
    // Look up association by name or table name
    const assoc = this._associations.find(
      (a) => a.name === name || a.toTable === name,
    );
    if (!assoc) {
      throw new Error(`No association "${name}" on ${this._table}`);
    }

    if (assoc.type === "has_many_through" && assoc.through) {
      // Double join: base → join table → target
      // Join table: join on our PK = join_table.our_fk
      this._joins.push({
        table: assoc.through,
        type,
        on: [`${assoc.through}.${assoc.foreignKey}`, `${this._table}.${this._primaryKey}`],
      });
      // Target table: guess FK as target_table_singular_id
      const targetModel = this._registry[
        Object.keys(this._registry).find(
          (k) => this._registry[k]._table === assoc.toTable,
        ) ?? ""
      ];
      const targetPk = targetModel?._primaryKey ?? "id";
      const targetFk = `${assoc.toTable.replace(/s$/, "")}_id`;
      this._joins.push({
        table: assoc.toTable,
        type,
        on: [`${assoc.toTable}.${targetPk}`, `${assoc.through}.${targetFk}`],
      });
    } else if (assoc.type === "belongs_to") {
      // We have the FK, join to parent's PK
      const targetModel = this._registry[
        Object.keys(this._registry).find(
          (k) => this._registry[k]._table === assoc.toTable,
        ) ?? ""
      ];
      const targetPk = targetModel?._primaryKey ?? "id";
      this._joins.push({
        table: assoc.toTable,
        type,
        on: [`${assoc.toTable}.${targetPk}`, `${this._table}.${assoc.foreignKey}`],
      });
    } else {
      // has_many / has_one: child has FK pointing to our PK
      this._joins.push({
        table: assoc.toTable,
        type,
        on: [`${assoc.toTable}.${assoc.foreignKey}`, `${this._table}.${this._primaryKey}`],
      });
    }
  }

  // Terminal properties

  get first(): QueryChain {
    // If already limited (e.g. last(3).first), pick from parent result in memory
    if (this._limitN !== undefined) {
      return this._pickFromResult(0);
    }
    const q = this._clone();
    q._single = true;
    if (q._orderBys.length === 0) q._orderBys.push([this._primaryKey, "asc"]);
    q._limitN = 1;
    return q;
  }

  _firstN(n: number): QueryChain {
    if (this._limitN !== undefined) {
      return this._sliceFromResult(0, n);
    }
    const q = this._clone();
    if (q._orderBys.length === 0) q._orderBys.push([this._primaryKey, "asc"]);
    q._limitN = n;
    return q;
  }

  get last(): QueryChain {
    if (this._limitN !== undefined) {
      return this._pickFromResult(-1);
    }
    const q = this._clone();
    q._single = true;
    q._orderBys = [[this._primaryKey, "desc"]];
    q._limitN = 1;
    return q;
  }

  _lastN(n: number): QueryChain {
    if (this._limitN !== undefined) {
      return this._sliceFromResult(-n);
    }
    const q = this._clone();
    q._orderBys = [[this._primaryKey, "desc"]];
    q._limitN = n;
    return q;
  }

  /** Pick a single record from parent result by index (supports negative) */
  private _pickFromResult(index: number): QueryChain {
    const parent = this;
    const dummy = this._clone();
    dummy._single = true;
    // Override _execute to pick from parent
    dummy._execute = async () => {
      const rows = await parent._execute();
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const i = index < 0 ? rows.length + index : index;
      return rows[i] ?? null;
    };
    return dummy;
  }

  /** Slice N records from parent result (supports negative start) */
  private _sliceFromResult(start: number, end?: number): QueryChain {
    const parent = this;
    const dummy = this._clone();
    dummy._execute = async () => {
      const rows = await parent._execute();
      if (!Array.isArray(rows)) return rows ? [rows] : [];
      if (start < 0) return rows.slice(start);
      return end !== undefined ? rows.slice(start, end) : rows.slice(start);
    };
    return dummy;
  }

  get count(): Promise<number> {
    return (async () => {
      const countExpr = this._distinct
        ? sql`count(distinct ${sql.ref(this._table + "." + this._primaryKey)})`.as("count")
        : sql`count(*)`.as("count");
      let q = this._db.selectFrom(this._table).select(countExpr);
      q = this._applyJoins(q);
      q = this._applyWheres(q);
      const row = await (q as any).executeTakeFirst();
      return Number(row?.count ?? 0);
    })();
  }

  get size(): Promise<number> { return this.count; }
  get length(): Promise<number> { return this.count; }

  pluck(column: string): Promise<unknown[]> {
    return (async () => {
      let q = this._db.selectFrom(this._table).select(column as any);
      q = this._applyJoins(q);
      q = this._applyWheres(q);
      if (this._distinct) q = q.distinct();
      for (const [col, dir] of this._orderBys) q = q.orderBy(col as any, dir);
      if (this._limitN) q = q.limit(this._limitN);
      if (this._offsetN) q = q.offset(this._offsetN);
      const rows = await q.execute();
      return rows.map((r: any) => r[column]);
    })();
  }

  get exists(): Promise<boolean> {
    return this.count.then((c) => c > 0);
  }

  // Mutation methods

  async update(attrs: Row): Promise<number> {
    let q = this._db.updateTable(this._table).set(attrs as any);
    q = this._applyWheres(q);
    const result = await q.execute();
    return Number((result as any)[0]?.numUpdatedRows ?? 0);
  }

  async destroy(): Promise<number> {
    let q = this._db.deleteFrom(this._table);
    q = this._applyWheres(q);
    const result = await q.execute();
    return Number((result as any)[0]?.numDeletedRows ?? 0);
  }

  // SQL preview

  toSql(): { sql: string; parameters: readonly unknown[] } {
    let q = this._db.selectFrom(this._table).selectAll(this._table as any) as any;
    q = this._applyJoins(q);
    q = this._applyWheres(q);
    if (this._distinct) q = q.distinct();
    for (const [col, dir] of this._orderBys) q = q.orderBy(col as any, dir);
    if (this._limitN) q = q.limit(this._limitN);
    if (this._offsetN) q = q.offset(this._offsetN);
    return q.compile();
  }

  // Thenable

  then(resolve: (value: any) => any, reject?: (reason: any) => any) {
    return this._execute().then(resolve, reject);
  }

  async *[Symbol.asyncIterator]() {
    const results = await this._execute();
    if (Array.isArray(results)) yield* results;
    else if (results) yield results;
  }

  // Internal

  _applyJoins(q: any): any {
    for (const join of this._joins) {
      if (join.type === "left") {
        q = q.leftJoin(join.table, join.on[0], join.on[1]);
      } else {
        q = q.innerJoin(join.table, join.on[0], join.on[1]);
      }
    }
    return q;
  }

  _applyWheres(q: any): any {
    for (const [col, op, val] of this._wheres) {
      q = q.where(col as any, op as any, val);
    }
    return q;
  }

  _execute(): Promise<any> {
    return (async () => {
      let q = this._db.selectFrom(this._table).selectAll(this._table as any) as any;
      q = this._applyJoins(q);
      q = this._applyWheres(q);
      if (this._distinct) q = q.distinct();
      for (const [col, dir] of this._orderBys) q = q.orderBy(col as any, dir);
      if (this._limitN) q = q.limit(this._limitN);
      if (this._offsetN) q = q.offset(this._offsetN);

      if (this._single) {
        const row = await q.executeTakeFirst();
        if (!row) return null;
        return new Record(
          this._db, this._table, this._primaryKey,
          this._columns, this._associations, this._registry, row,
        );
      }

      const rows = await q.execute();
      return rows.map((r: Row) => new Record(
        this._db, this._table, this._primaryKey,
        this._columns, this._associations, this._registry, r,
      ));
    })();
  }

  [Symbol.for("nodejs.util.inspect.custom")]() {
    const { sql: s, parameters } = this.toSql();
    return `QueryChain<${this._table}> ${s} [${parameters}]`;
  }
}
