import { sql, type Kysely } from "kysely";
import type { Database } from "./types.ts";

type TableName = keyof Database;
type Row = globalThis.Record<string, unknown>;

// ── Known properties on QueryChain (don't intercept these) ──────────
const CHAIN_PROPS = new Set([
  "where", "not", "order", "limit", "offset",
  "first", "last", "count", "exists", "pluck", "update", "destroy",
  "toSql", "then", "constructor", "prototype",
  // private
  "_db", "_table", "_wheres", "_orderBys", "_limitN", "_offsetN",
  "_single", "_clone", "_applyWheres", "_execute",
]);

// ── Proxy wrapper: makes `chain.email` resolve to the attribute ─────
function wrapChain(chain: QueryChain): QueryChain {
  return new Proxy(chain, {
    get(target, prop, receiver) {
      // Symbols always delegate (then, asyncIterator, inspect, etc.)
      if (typeof prop === "symbol") {
        return Reflect.get(target, prop, receiver);
      }

      // Known chain methods/properties — delegate, but wrap returned chains
      if (CHAIN_PROPS.has(prop) || prop.startsWith("_")) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === "function") {
          return (...args: any[]) => {
            const result = value.apply(target, args);
            return result instanceof QueryChain ? wrapChain(result) : result;
          };
        }
        // Getters that return chains (first, last)
        if (value instanceof QueryChain) return wrapChain(value);
        return value;
      }

      // Unknown property → attribute projection (the magic)
      // `Account.first.email` → executes query, returns record.email
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

// ── QueryChain: lazy, chainable, thenable ───────────────────────────

export class QueryChain {
  _db: Kysely<Database>;
  _table: TableName;
  _wheres: [string, string, unknown][] = [];
  _orderBys: [string, "asc" | "desc"][] = [];
  _limitN?: number;
  _offsetN?: number;
  _single = false;

  constructor(db: Kysely<Database>, table: TableName) {
    this._db = db;
    this._table = table;
  }

  _clone(): QueryChain {
    const q = new QueryChain(this._db, this._table);
    q._wheres = [...this._wheres];
    q._orderBys = [...this._orderBys];
    q._limitN = this._limitN;
    q._offsetN = this._offsetN;
    q._single = this._single;
    return q;
  }

  // ── Chainable query methods ─────────────────────────────────────

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

  // ── Terminal properties ───────────────────────────────────────────

  get first(): QueryChain {
    const q = this._clone();
    q._limitN = 1;
    q._single = true;
    if (q._orderBys.length === 0) q._orderBys.push(["created_at", "asc"]);
    return q;
  }

  get last(): QueryChain {
    const q = this._clone();
    q._limitN = 1;
    q._single = true;
    q._orderBys = [["created_at", "desc"]];
    return q;
  }

  get count(): Promise<number> {
    return (async () => {
      let q = this._db.selectFrom(this._table as any).select(sql`count(*)`.as("count"));
      q = this._applyWheres(q);
      const row = await (q as any).executeTakeFirst();
      return Number(row?.count ?? 0);
    })();
  }

  pluck(column: string): Promise<unknown[]> {
    return (async () => {
      let q = this._db.selectFrom(this._table as any).select(column as any);
      q = this._applyWheres(q);
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

  // ── Mutation methods ────────────────────────────────────────────

  async update(attrs: Row): Promise<number> {
    let q = this._db.updateTable(this._table as any).set(attrs as any);
    q = this._applyWheres(q);
    const result = await q.execute();
    return Number((result as any)[0]?.numUpdatedRows ?? 0);
  }

  async destroy(): Promise<number> {
    let q = this._db.deleteFrom(this._table as any);
    q = this._applyWheres(q);
    const result = await q.execute();
    return Number((result as any)[0]?.numDeletedRows ?? 0);
  }

  // ── SQL preview ─────────────────────────────────────────────────

  toSql(): { sql: string; parameters: readonly unknown[] } {
    let q = this._db.selectFrom(this._table as any).selectAll() as any;
    q = this._applyWheres(q);
    for (const [col, dir] of this._orderBys) q = q.orderBy(col as any, dir);
    if (this._limitN) q = q.limit(this._limitN);
    if (this._offsetN) q = q.offset(this._offsetN);
    return q.compile();
  }

  // ── Thenable ────────────────────────────────────────────────────

  then(resolve: (value: any) => any, reject?: (reason: any) => any) {
    return this._execute().then(resolve, reject);
  }

  async *[Symbol.asyncIterator]() {
    const results = await this._execute();
    if (Array.isArray(results)) yield* results;
    else if (results) yield results;
  }

  // ── Internal ────────────────────────────────────────────────────

  _applyWheres(q: any): any {
    for (const [col, op, val] of this._wheres) {
      q = q.where(col as any, op as any, val);
    }
    return q;
  }

  _execute(): Promise<any> {
    return (async () => {
      let q = this._db.selectFrom(this._table as any).selectAll() as any;
      q = this._applyWheres(q);
      for (const [col, dir] of this._orderBys) q = q.orderBy(col as any, dir);
      if (this._limitN) q = q.limit(this._limitN);
      if (this._offsetN) q = q.offset(this._offsetN);

      if (this._single) {
        const row = await q.executeTakeFirst();
        if (!row) return null;
        return new Record(this._db, this._table, row);
      }

      const rows = await q.execute();
      return rows.map((r: Row) => new Record(this._db, this._table, r));
    })();
  }

  [Symbol.for("nodejs.util.inspect.custom")]() {
    const { sql: s, parameters } = this.toSql();
    return `QueryChain<${this._table}> ${s} [${parameters}]`;
  }
}

// ── Record: an instance with AR-style methods ───────────────────────

export class Record {
  private _db: Kysely<Database>;
  private _table: TableName;
  private _attrs: Row;
  private _persisted: boolean;

  [key: string]: unknown;

  constructor(db: Kysely<Database>, table: TableName, attrs: Row) {
    this._db = db;
    this._table = table;
    this._attrs = { ...attrs };
    this._persisted = attrs.id !== undefined;

    for (const [k] of Object.entries(attrs)) {
      if (!(k in this)) {
        Object.defineProperty(this, k, {
          get: () => this._attrs[k],
          set: (val) => { this._attrs[k] = val; },
          enumerable: true,
          configurable: true,
        });
      }
    }
  }

  get attributes(): Row {
    return { ...this._attrs };
  }

  get isPersisted(): boolean {
    return this._persisted;
  }

  async update(attrs: Row): Promise<Record> {
    if (!this._attrs.id) throw new Error("Cannot update a record without an id");
    await this._db
      .updateTable(this._table as any)
      .set(attrs as any)
      .where("id" as any, "=", this._attrs.id)
      .execute();

    Object.assign(this._attrs, attrs);
    for (const [k] of Object.entries(attrs)) {
      if (!Object.getOwnPropertyDescriptor(this, k)?.get) {
        Object.defineProperty(this, k, {
          get: () => this._attrs[k],
          set: (val) => { this._attrs[k] = val; },
          enumerable: true,
          configurable: true,
        });
      }
    }
    return this;
  }

  async destroy(): Promise<boolean> {
    if (!this._attrs.id) throw new Error("Cannot destroy a record without an id");
    await this._db
      .deleteFrom(this._table as any)
      .where("id" as any, "=", this._attrs.id)
      .execute();
    this._persisted = false;
    return true;
  }

  async reload(): Promise<Record> {
    if (!this._attrs.id) throw new Error("Cannot reload a record without an id");
    const row = await this._db
      .selectFrom(this._table as any)
      .selectAll()
      .where("id" as any, "=", this._attrs.id)
      .executeTakeFirst();
    if (!row) throw new Error(`Record not found: ${this._table}#${this._attrs.id}`);
    this._attrs = { ...(row as Row) };
    return this;
  }

  [Symbol.for("nodejs.util.inspect.custom")]() {
    return this._attrs;
  }

  toJSON(): Row {
    return this._attrs;
  }
}

// ── Model ───────────────────────────────────────────────────────────

export interface Model {
  all: QueryChain;
  first: QueryChain;
  last: QueryChain;
  count: Promise<number>;
  where(columnOrConditions: string | Row, value?: unknown): QueryChain;
  not(conditions: Row): QueryChain;
  find(id: string | number): Promise<Record | null>;
  findBy(conditions: Row): Promise<Record | null>;
  pluck(column: string): Promise<unknown[]>;
  create(attrs: Row): Promise<Record>;
  order(column: string, direction?: "asc" | "desc"): QueryChain;
  limit(n: number): QueryChain;
  exists(conditions?: Row): Promise<boolean>;
}

export function createModel(db: Kysely<Database>, table: TableName): Model {
  const base = () => wrapChain(new QueryChain(db, table));

  return {
    get all() {
      return base();
    },
    get first() {
      return base().first;
    },
    get last() {
      return base().last;
    },
    get count() {
      return base().count;
    },
    where(columnOrConditions: string | Row, value?: unknown) {
      return base().where(columnOrConditions, value);
    },
    not(conditions: Row) {
      return base().not(conditions);
    },
    find(id: string | number) {
      return base().where({ id }).first as unknown as Promise<Record | null>;
    },
    findBy(conditions: Row) {
      return base().where(conditions).first as unknown as Promise<Record | null>;
    },
    pluck(column: string) {
      return base().pluck(column);
    },
    async create(attrs: Row) {
      const row = await db
        .insertInto(table as any)
        .values(attrs as any)
        .returningAll()
        .executeTakeFirstOrThrow();
      return new Record(db, table, row as Row);
    },
    order(column: string, direction: "asc" | "desc" = "asc") {
      return base().order(column, direction);
    },
    limit(n: number) {
      return base().limit(n);
    },
    async exists(conditions?: Row) {
      const chain = conditions ? base().where(conditions) : base();
      return chain.exists;
    },
  };
}

// ── Factory ─────────────────────────────────────────────────────────

export function createModels(db: Kysely<Database>): globalThis.Record<string, Model> {
  const tables: TableName[] = [
    "blocks", "transactions", "events", "streams", "stream_metrics",
    "jobs", "index_progress", "deliveries", "views", "api_keys",
    "accounts", "sessions", "magic_links", "usage_daily", "usage_snapshots",
  ];

  const models: globalThis.Record<string, Model> = {};
  for (const table of tables) {
    const name = table
      .split("_")
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join("")
      .replace(/ies$/, "y")
      .replace(/ses$/, "s")
      .replace(/([^s])s$/, "$1");

    models[name] = createModel(db, table);
  }
  return models;
}
