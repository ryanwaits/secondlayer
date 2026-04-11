import * as readline from "node:readline";
import { sendApprovalNotification } from "@secondlayer/auth/email";
import { approveWaitlistEntry } from "@secondlayer/shared/db/queries/accounts";
import { type Kysely, sql } from "kysely";
import type { ModelRegistry } from "../model/types.ts";
import type { AssociationMap } from "../schema/associations.ts";
import type { SchemaInfo } from "../schema/types.ts";
import { cyan, dim, green, red } from "./colors.ts";
import { createCommands } from "./commands.ts";
import { createCompleter } from "./completer.ts";
import { evalExpr, rubyToJs } from "./eval.ts";
import { printResult } from "./printer.ts";

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
		const result = await approveWaitlistEntry(db, email);

		if (result.status === "not_found") {
			console.log(red(`  No waitlist entry for ${email}`));
			return;
		}
		if (result.status === "already_approved") {
			console.log(red(`  ${email} is already approved`));
			return;
		}

		await sendApprovalNotification(email, result.token);
		console.log(green(`  Approved ${email} — token: ${result.token}`));
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
