#!/usr/bin/env bun
import * as readline from "node:readline";
import util from "node:util";
import { getDb, closeDb, sql } from "./db/index.ts";
import { parseJsonb } from "./db/jsonb.ts";
import { createModels, type Model } from "./db/model.ts";
import * as accounts from "./db/queries/accounts.ts";
import * as usage from "./db/queries/usage.ts";
import * as integrity from "./db/queries/integrity.ts";
import * as metrics from "./db/queries/metrics.ts";
import * as views from "./db/queries/views.ts";
import type { Database } from "./db/types.ts";

// ── Table metadata ──────────────────────────────────────────────────
const TABLE_NAMES: (keyof Database)[] = [
  "blocks",
  "transactions",
  "events",
  "streams",
  "stream_metrics",
  "jobs",
  "index_progress",
  "deliveries",
  "views",
  "api_keys",
  "accounts",
  "sessions",
  "magic_links",
  "usage_daily",
  "usage_snapshots",
];

// ── Pretty printing ─────────────────────────────────────────────────
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

function printTable(rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    console.log(dim("  (empty)"));
    return;
  }

  const keys = Object.keys(rows[0]);
  const fmt = (v: unknown): string => {
    if (v === null) return "NULL";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };

  const widths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => Math.min(fmt(r[k]).length, 40))),
  );

  const header = keys.map((k, i) => cyan(k.padEnd(widths[i]))).join(dim("  │  "));
  const sep = widths.map((w) => "─".repeat(w)).join(dim("──┼──"));
  console.log(`  ${header}`);
  console.log(dim(`  ${sep}`));

  for (const row of rows) {
    const line = keys
      .map((k, i) => {
        const v = row[k];
        if (v === null) return dim("NULL".padEnd(widths[i]));
        let s = fmt(v);
        if (s.length > 40) s = s.slice(0, 37) + "...";
        return s.padEnd(widths[i]);
      })
      .join(dim("  │  "));
    console.log(`  ${line}`);
  }

  console.log(dim(`\n  ${rows.length} row${rows.length === 1 ? "" : "s"}`));
}

function printRecord(obj: Record<string, unknown>) {
  const maxKey = Math.max(...Object.keys(obj).map((k) => k.length));
  for (const [k, v] of Object.entries(obj)) {
    const val = v === null ? dim("NULL") : typeof v === "object" ? JSON.stringify(v) : String(v);
    console.log(`  ${cyan(k.padEnd(maxKey))}  ${val}`);
  }
}

function toPlain(obj: unknown): Record<string, unknown> {
  if (obj && typeof obj === "object" && "attributes" in obj && typeof (obj as any).attributes === "object") {
    return (obj as any).attributes;
  }
  return obj as Record<string, unknown>;
}

function printResult(output: unknown) {
  if (output === undefined || output === null) {
    console.log(dim(`  ${output}`));
    return;
  }
  if (Array.isArray(output)) {
    if (output.length === 0) {
      console.log(dim("  (empty)"));
      return;
    }
    if (typeof output[0] === "object" && output[0] !== null) {
      printTable(output.map(toPlain));
    } else {
      console.log(`  ${util.inspect(output, { colors: true, depth: 6 })}`);
    }
  } else if (typeof output === "object" && output !== null) {
    printRecord(toPlain(output));
  } else {
    console.log(`  ${util.inspect(output, { colors: true, depth: 6 })}`);
  }
}

// ── Connect ─────────────────────────────────────────────────────────
const dbUrl = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/streams_dev";
const db = getDb(dbUrl);

try {
  await sql`SELECT 1`.execute(db);
} catch (e: any) {
  console.error(red(`Failed to connect: ${e.message}`));
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────
async function count(table: keyof Database) {
  const { rows } = await sql<{ count: string }>`
    SELECT count(*)::text as count FROM ${sql.ref(table)}
  `.execute(db);
  return Number(rows[0]?.count ?? 0);
}

async function first(table: keyof Database, where?: Record<string, unknown>) {
  let query = db.selectFrom(table as any).selectAll() as any;
  if (where) {
    for (const [k, v] of Object.entries(where)) {
      query = query.where(k, "=", v);
    }
  }
  return (await query.limit(1).executeTakeFirst()) ?? null;
}

async function all(table: keyof Database, limit = 25) {
  return db.selectFrom(table as any).selectAll().limit(limit).execute();
}

async function recent(table: keyof Database, limit = 10) {
  return db
    .selectFrom(table as any)
    .selectAll()
    .orderBy("created_at" as any, "desc")
    .limit(limit)
    .execute();
}

async function rawSql(query: string) {
  const { rows } = await sql.raw(query).execute(db);
  return rows;
}

// ── Models (ActiveRecord-style) ─────────────────────────────────────
const models = createModels(db);

// ── REPL context — everything accessible in eval ────────────────────
const ctx: Record<string, unknown> = {
  db,
  sql,
  count,
  first,
  all,
  recent,
  rawSql,
  parseJsonb,
  accounts,
  usage,
  integrity,
  metrics,
  views,
  // Inject each model: Account, Stream, Block, etc.
  ...models,
};

// ── Dot commands ────────────────────────────────────────────────────
const commands: Record<string, (arg: string) => Promise<void>> = {
  async tables() {
    for (const t of TABLE_NAMES) console.log(`  ${t}`);
  },

  async counts() {
    const rows: Record<string, unknown>[] = [];
    for (const t of TABLE_NAMES) {
      const c = await count(t);
      rows.push({ table: t, rows: c });
    }
    printTable(rows);
  },

  async desc(tableName: string) {
    const name = tableName.trim();
    if (!name || !TABLE_NAMES.includes(name as any)) {
      console.log(dim(`  Unknown table: "${name}". Use .tables to list.`));
      return;
    }
    const { rows } = await sql<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${name}
      ORDER BY ordinal_position
    `.execute(db);

    printTable(
      rows.map((r) => ({
        column: r.column_name,
        type: r.data_type,
        nullable: r.is_nullable,
        default: r.column_default ?? "",
      })),
    );
  },

  async help() {
    console.log(dim("  ActiveRecord-style:"));
    console.log(`    ${green("Account")}.all                ${dim("all rows (lazy, chainable)")}`);
    console.log(`    ${green("Account")}.find(id)            ${dim("find by primary key")}`);
    console.log(`    ${green("Account")}.findBy({ email })   ${dim("find first matching")}`);
    console.log(`    ${green("Account")}.where({ plan })     ${dim("chainable query")}`);
    console.log(`    ${green("Account")}.where({}).limit(5)  ${dim("chain .limit, .order, .offset")}`);
    console.log(`    ${green("Account")}.first / .last       ${dim("first/last by created_at")}`);
    console.log(`    ${green("Account")}.count               ${dim("count rows")}`);
    console.log(`    ${green("Account")}.pluck("email")      ${dim("array of single column")}`);
    console.log(`    ${green("Account")}.create({ ... })     ${dim("INSERT RETURNING")}`);
    console.log(`    ${green("account")}.update({ ... })     ${dim("update instance")}`);
    console.log(`    ${green("account")}.destroy()           ${dim("delete instance")}`);
    console.log(`    ${green("account")}.reload()            ${dim("re-fetch from DB")}`);
    console.log("");
    console.log(dim("  Raw helpers:"));
    console.log(`    ${green("db")}                        ${dim("Kysely instance")}`);
    console.log(`    ${green("rawSql")}${dim("(query)")}               ${dim("run raw SQL string")}`);
    console.log(`    ${green("sql")}                        ${dim("Kysely sql tag")}`);
    console.log("");
    console.log(dim("  Commands:"));
    console.log(`    ${green(".tables")}                    ${dim("list all tables")}`);
    console.log(`    ${green(".counts")}                    ${dim("row counts for all tables")}`);
    console.log(`    ${green(".desc")} ${dim("<table>")}               ${dim("describe table columns")}`);
    console.log(`    ${green(".help")}                      ${dim("show this help")}`);
    console.log(`    ${green(".exit")}                      ${dim("quit")}`);
  },
};

// ── Eval ────────────────────────────────────────────────────────────
async function evalExpr(expr: string): Promise<unknown> {
  const keys = Object.keys(ctx);
  const vals = Object.values(ctx);
  const asyncFn = new Function(...keys, `return (async () => { return (${expr}); })()`);
  return asyncFn(...vals);
}

// Rewrite Ruby-style hash args: where(email: "x") → where({ email: "x" })
function rubyToJs(input: string): string {
  return input.replace(
    /\.(where|not|findBy)\((\w+:\s)/g,
    ".$1({ $2",
  ).replace(
    // close the brace before the closing paren if we opened one
    /\.\b(where|not|findBy)\(\{([^)]+)\)/g,
    ".$1({ $2 })",
  );
}

async function evaluate(input: string) {
  const line = rubyToJs(input.trim());
  if (!line) return;

  // dot commands
  if (line.startsWith(".")) {
    const [cmd, ...rest] = line.slice(1).split(/\s+/);
    const handler = commands[cmd];
    if (handler) {
      await handler(rest.join(" "));
    } else if (cmd === "exit" || cmd === "quit") {
      await shutdown();
    } else {
      console.log(dim(`  Unknown command: .${cmd}`));
    }
    return;
  }

  // Variable assignment: persist across lines
  const varMatch = line.match(/^(?:const|let|var)\s+(\w+)\s*=\s*([\s\S]+)$/);
  if (varMatch) {
    const [, name, expr] = varMatch;
    try {
      const result = await evalExpr(expr);
      ctx[name] = result;
      printResult(result);
    } catch (e: any) {
      console.log(red(`  ${e.message}`));
    }
    return;
  }

  // Expression eval
  try {
    const result = await evalExpr(line);
    printResult(result);
  } catch (e: any) {
    console.log(red(`  ${e.message}`));
  }
}

// ── Tab completion ──────────────────────────────────────────────────
function completer(line: string, callback: (err: null, result: [string[], string]) => void) {
  const tokens = [
    ...TABLE_NAMES.map(String),
    ...Object.keys(ctx),
    ".tables",
    ".counts",
    ".desc",
    ".help",
    ".exit",
  ];
  const trimmed = line.trim();
  const hits = tokens.filter((t) => t.startsWith(trimmed));
  callback(null, [hits.length ? hits : tokens, trimmed]);
}

// ── Shutdown ────────────────────────────────────────────────────────
async function shutdown() {
  console.log(dim("\n  Disconnecting..."));
  await closeDb();
  rl.close();
  process.exit(0);
}

// ── Banner ──────────────────────────────────────────────────────────
const host = dbUrl.match(/@([^:\/]+)/)?.[1] || "localhost";
const dbName = dbUrl.match(/\/([^/?]+)(\?|$)/)?.[1] || "unknown";

console.log("");
console.log(bold("  conductor"));
console.log(dim(`  ${host}/${dbName}`));
console.log("");
console.log(dim("  Models: ") + Object.keys(models).join(", "));
console.log(dim("  Type .help for commands, .exit to quit"));
console.log("");

// ── Start REPL ──────────────────────────────────────────────────────
const isInteractive = process.stdin.isTTY ?? false;
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: `${cyan("console")} ${dim("›")} `,
  ...(isInteractive ? { completer } : {}),
  terminal: isInteractive,
  historySize: 1000,
});

rl.prompt();

let processing = Promise.resolve();
rl.on("line", (line) => {
  processing = processing.then(async () => {
    await evaluate(line);
    rl.prompt();
  });
});

rl.on("close", () => {
  processing.then(() => shutdown());
});
