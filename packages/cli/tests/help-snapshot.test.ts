import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Command } from "commander";
import { registerBootstrapCommand } from "../src/commands/bootstrap.ts";
import { registerCodegenCommand } from "../src/commands/codegen.ts";
import { registerIndexCommand } from "../src/commands/index-api.ts";
import { registerInitCommand } from "../src/commands/init.ts";
import { registerLoginCommand } from "../src/commands/login.ts";
import { registerObserverCommand } from "../src/commands/observer.ts";
import { registerSetupCommand } from "../src/commands/setup.ts";
import { registerStreamsCommand } from "../src/commands/streams.ts";
import { registerSubgraphsCommand } from "../src/commands/subgraphs.ts";

/**
 * DX acceptance: top-level help shows init/bootstrap/observer and hides the
 * hosted login verb; retired hosted verbs (instance/account/keys/projects)
 * never reappear.
 */
/** The help screen as a user sees it, including `addHelpText` blocks. */
function renderHelp(command: Command | undefined): string {
	if (!command) return "";
	let out = "";
	command.configureOutput({
		writeOut: (str) => {
			out += str;
		},
	});
	command.outputHelp();
	return out;
}

describe("CLI help snapshot", () => {
	test("init, bootstrap, and observer are listed; hosted verbs are absent", () => {
		const program = new Command().name("sl");
		registerInitCommand(program);
		registerBootstrapCommand(program);
		registerObserverCommand(program);
		registerLoginCommand(program);

		const help = program.helpInformation();
		expect(help).toMatch(/^\s+init\b/m);
		expect(help).toMatch(/^\s+bootstrap\b/m);
		expect(help).toMatch(/^\s+observer\b/m);
		expect(help).not.toMatch(/^\s+instance\b/m);
		expect(help).not.toMatch(/^\s+login\b/m);
		expect(help).not.toMatch(/^\s+account\b/m);
		expect(help).not.toMatch(/^\s+keys\b/m);
		expect(help).not.toMatch(/^\s+projects\b/m);
	});

	test("the removed start verb is not registered; setup owns bringing the stack up", () => {
		const program = new Command().name("sl");
		registerSetupCommand(program);
		registerInitCommand(program);
		expect(program.commands.map((c) => c.name())).not.toContain("start");
		expect(program.commands.map((c) => c.name())).toContain("setup");
	});

	test("setup --dir advertises '.' rather than the absolute cwd the help was rendered from", () => {
		const program = new Command().name("sl");
		registerSetupCommand(program);
		const setup = program.commands.find((c) => c.name() === "setup");
		const dir = setup?.options.find((o) => o.long === "--dir");
		expect(dir?.defaultValue).toBe(".");
	});

	test("flags that the global options already own are not redeclared on subcommands", () => {
		// A command-local copy of a global flag is bound by Commander to the
		// ancestor, so the subcommand reads undefined and silently falls back
		// to its own default. init --api-url and scaffold --api-key both did.
		const program = new Command().name("sl");
		registerInitCommand(program);
		registerSubgraphsCommand(program);
		const init = program.commands.find((c) => c.name() === "init");
		expect(init?.options.map((o) => o.long)).not.toContain("--api-url");
		expect(init?.options.map((o) => o.long)).not.toContain("--network");
		const scaffold = program.commands
			.find((c) => c.name() === "subgraphs")
			?.commands.find((c) => c.name() === "scaffold");
		expect(scaffold?.options.map((o) => o.long)).not.toContain("--api-key");
	});

	test("renamed verbs advertise the canonical name and hide the old spelling", () => {
		const program = new Command().name("sl");
		registerSubgraphsCommand(program);
		registerStreamsCommand(program);

		const subgraphsHelp =
			program.commands
				.find((c) => c.name() === "subgraphs")
				?.helpInformation() ?? "";
		expect(subgraphsHelp).toMatch(/^\s+stop\b/m);
		expect(subgraphsHelp).not.toMatch(/^\s+cancel\b/m);
		expect(subgraphsHelp).toMatch(/^\s+operations\b/m);
		expect(subgraphsHelp).toMatch(/^\s+source\b/m);
		expect(subgraphsHelp).not.toMatch(/^\s+publish\b/m);
		expect(subgraphsHelp).not.toMatch(/^\s+unpublish\b/m);

		const streamsHelp =
			program.commands.find((c) => c.name() === "streams")?.helpInformation() ??
			"";
		expect(streamsHelp).toMatch(/^\s+dumps\b/m);
		expect(streamsHelp).not.toMatch(/^\s+pull\b/m);
	});

	test("the removed per-product spellings are not registered at all", () => {
		const program = new Command().name("sl");
		registerSubgraphsCommand(program);
		registerStreamsCommand(program);
		registerIndexCommand(program);

		const names = (parent: string): string[] =>
			program.commands
				.find((c) => c.name() === parent)
				?.commands.flatMap((c) => [c.name(), ...c.aliases()]) ?? [];

		expect(names("subgraphs")).not.toContain("cancel");
		expect(names("subgraphs")).not.toContain("codegen");
		expect(names("subgraphs")).not.toContain("client");
		expect(names("subgraphs")).not.toContain("publish");
		expect(names("subgraphs")).not.toContain("unpublish");
		expect(names("streams")).not.toContain("pull");
		expect(names("index")).not.toContain("codegen");
		expect(program.commands.map((c) => c.name())).not.toContain("contracts");
	});

	test("one starting command is named the default and each overlapping one points at the other", () => {
		// `create` and `scaffold` both start a subgraph, and an agent reading
		// either screen used to have no way to choose without opening the other.
		const program = new Command().name("sl");
		registerSubgraphsCommand(program);
		const subgraphs = program.commands.find((c) => c.name() === "subgraphs");

		const create = subgraphs?.commands.find((c) => c.name() === "create");
		const scaffold = subgraphs?.commands.find((c) => c.name() === "scaffold");
		expect(create?.description()).toContain("Start here");
		expect(create?.description()).toContain("subgraphs scaffold");
		expect(scaffold?.description()).toContain("subgraphs create");

		// `helpInformation()` omits addHelpText blocks, so render the real screen.
		expect(renderHelp(create)).toContain("secondlayer subgraphs scaffold");
		expect(renderHelp(scaffold)).toContain("secondlayer subgraphs create");
	});

	test("codegen carries every generated artifact", () => {
		const program = new Command().name("sl");
		registerCodegenCommand(program);

		const codegen = program.commands.find((c) => c.name() === "codegen");
		expect(codegen?.commands.map((c) => c.name()).sort()).toEqual([
			"client",
			"contracts",
			"index",
			"prints",
			"subgraph",
		]);

		const contracts = codegen?.commands.find((c) => c.name() === "contracts");
		// The retired `contracts generate` accepted these four flags; the
		// canonical verb has to cover all of them or the removal drops a feature.
		expect(contracts?.options.map((o) => o.long).sort()).toEqual([
			"--api-key",
			"--config",
			"--output",
			"--watch",
		]);
	});

	test("the quickstart stages the created file before deploy, since deploy refuses an unstaged one", async () => {
		const proc = Bun.spawn(
			[
				process.execPath,
				"run",
				join(import.meta.dir, "../src/cli.ts"),
				"--help",
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const [help, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		expect(exitCode).toBe(0);
		const create = help.indexOf("subgraphs create my-watcher");
		const add = help.indexOf("git add subgraphs/my-watcher.ts");
		const deploy = help.indexOf("subgraphs deploy subgraphs/my-watcher.ts");
		expect(create).toBeGreaterThan(-1);
		expect(add).toBeGreaterThan(create);
		expect(deploy).toBeGreaterThan(add);
		expect(help).toMatch(/--allow-uncommitted/);
	}, 30_000);
});
