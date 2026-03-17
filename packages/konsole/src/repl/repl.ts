import * as readline from "node:readline";
import { sql, type Kysely } from "kysely";
import type { SchemaInfo } from "../schema/types.ts";
import type { AssociationMap } from "../schema/associations.ts";
import type { ModelRegistry } from "../model/types.ts";
import { rubyToJs, evalExpr } from "./eval.ts";
import { printResult } from "./printer.ts";
import { createCommands } from "./commands.ts";
import { createCompleter } from "./completer.ts";
import { dim, cyan, red, green } from "./colors.ts";
import { sendApprovalNotification } from "@secondlayer/auth/email";
import { createMagicLink } from "@secondlayer/shared/db/queries/accounts";

export interface ReplOptions {
  db: Kysely<any>;
  schema: SchemaInfo;
  associations: AssociationMap;
  models: ModelRegistry;
  close: () => Promise<void>;
}

export function startRepl(opts: ReplOptions) {
  const { db, schema, associations, models, close } = opts;
  const commands = createCommands(db, schema, associations);

  // Raw SQL helper
  async function rawSql(query: string) {
    const { rows } = await sql.raw(query).execute(db);
    return rows;
  }

  // Approve a waitlisted email: sets status, creates magic link, sends email
  async function approve(email: string) {
    const row = await sql<{ status: string }>`
      SELECT status FROM waitlist WHERE email = ${email} LIMIT 1
    `.execute(db);

    if (row.rows.length === 0) {
      console.log(red(`  No waitlist entry for ${email}`));
      return;
    }
    if (row.rows[0].status !== "pending") {
      console.log(red(`  ${email} is already ${row.rows[0].status}`));
      return;
    }

    await sql`UPDATE waitlist SET status = 'approved' WHERE email = ${email}`.execute(db);

    const token = Math.floor(100000 + Math.random() * 900000).toString();
    await createMagicLink(db, email, token, 7 * 24 * 60 * 60 * 1000);
    await sendApprovalNotification(email, token);

    console.log(green(`  Approved ${email} — token: ${token}`));
  }

  // Build eval context
  const ctx: Record<string, unknown> = {
    db,
    sql,
    rawSql,
    approve,
    ...models,
  };

  const completer = createCompleter(schema, models, ctx);

  const isInteractive = process.stdin.isTTY ?? false;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${cyan("konsole")} ${dim(">")} `,
    ...(isInteractive ? { completer } : {}),
    terminal: isInteractive,
    historySize: 1000,
  });

  async function shutdown() {
    console.log(dim("\n  Disconnecting..."));
    await close();
    rl.close();
    process.exit(0);
  }

  async function evaluate(input: string) {
    const line = rubyToJs(input.trim());
    if (!line) return;

    // Bare exit/quit
    if (line === "exit" || line === "quit") {
      await shutdown();
      return;
    }

    // Dot commands
    if (line.startsWith(".")) {
      const [cmd, ...rest] = line.slice(1).split(/\s+/);
      if (cmd === "exit" || cmd === "quit") {
        await shutdown();
        return;
      }
      const handler = commands[cmd];
      if (handler) {
        await handler(rest.join(" "));
      } else {
        console.log(dim(`  Unknown command: .${cmd}`));
      }
      return;
    }

    // Variable assignment
    const varMatch = line.match(/^(?:const|let|var)\s+(\w+)\s*=\s*([\s\S]+)$/);
    if (varMatch) {
      const [, name, expr] = varMatch;
      try {
        const result = await evalExpr(expr, ctx);
        ctx[name] = result;
        printResult(result);
      } catch (e: any) {
        console.log(red(`  ${e.message}`));
      }
      return;
    }

    // Expression eval
    try {
      const result = await evalExpr(line, ctx);
      printResult(result);
    } catch (e: any) {
      console.log(red(`  ${e.message}`));
    }
  }

  rl.prompt();

  let processing = Promise.resolve();
  rl.on("line", (line) => {
    processing = processing.then(async () => {
      await evaluate(line);
      rl.prompt();
    });
  });

  rl.on("SIGINT", () => {
    shutdown();
  });

  rl.on("close", () => {
    processing.then(() => shutdown());
  });
}
