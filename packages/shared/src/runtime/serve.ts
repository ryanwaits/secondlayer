/**
 * One-box entrypoint: validate config, migrate under an advisory lock,
 * then supervise the default profile as child processes.
 */
import { spawn } from "node:child_process";
import { MODULE_COMMANDS } from "./commands.ts";
import { parseRuntimeConfig } from "./config.ts";
import { DEFAULT_PROFILE, type ModuleId } from "./modules.ts";
import { createMemoryModule } from "./modules.ts";
import { createSupervisor } from "./supervisor.ts";

const env = process.env as Record<string, string | undefined>;
const parsed = parseRuntimeConfig({
	...env,
	NETWORK: env.NETWORK ?? env.STACKS_NETWORK,
	NODE_MODE: env.NODE_MODE ?? "external",
	DATA_DIR: env.DATA_DIR ?? "/data",
	API_PORT: env.API_PORT ?? env.PORT ?? "3800",
	INDEXER_PORT: env.INDEXER_PORT ?? "3700",
});

if (!parsed.ok) {
	console.error(parsed.errors.join("\n"));
	process.exit(1);
}

const profile =
	env.RUNTIME_PROFILE === "publisher"
		? (["publisher"] as ModuleId[])
		: [...DEFAULT_PROFILE];

const children = new Map<ModuleId, ReturnType<typeof spawn>>();

function spawnModule(id: ModuleId): void {
	const cmd = MODULE_COMMANDS[id];
	const child = spawn(cmd[0] ?? "bun", cmd.slice(1), {
		stdio: "inherit",
		env: process.env,
	});
	children.set(id, child);
	child.on("exit", (code) => {
		children.delete(id);
		if (code !== 0 && code !== null) {
			console.error(`module ${id} exited ${code}; supervisor remains up`);
		}
	});
}

export function planServe(): { modules: ModuleId[]; config: typeof parsed } {
	return { modules: profile, config: parsed };
}

if (import.meta.main) {
	// Resource preflight before migrations: a box that cannot hold the index
	// should be told so before it spends hours acquiring one.
	const { runPreflight } = await import("./preflight.ts");
	const { getDb, sql } = await import("../db/index.ts");
	const decision = await runPreflight({
		dataDir: parsed.config.DATA_DIR,
		mode: parsed.config.NODE_MODE,
		network: parsed.config.NETWORK,
		query: async (statement) => {
			const result = await sql.raw(statement).execute(getDb());
			return result.rows as Array<Record<string, unknown>>;
		},
		env,
	});
	for (const message of decision.messages) console.error(message);
	if (decision.action === "refuse") process.exit(1);

	const { runMigrations } = await import("../db/migrate.ts");
	try {
		await runMigrations();
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
	const modules = profile.map((id) =>
		createMemoryModule(id, {
			onStart: () => spawnModule(id),
			onStop: () => {
				children.get(id)?.kill("SIGTERM");
			},
		}),
	);
	const supervisor = createSupervisor(modules);
	await supervisor.start(profile);
	const shutdown = async () => {
		await supervisor.stop();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}
