/**
 * Parity-audit extractor for the CLI surface.
 *
 * Builds the real `@secondlayer/cli` command tree by invoking the same
 * `register*Command` functions `packages/cli/src/cli.ts` uses (plus the one
 * `contracts` group cli.ts defines inline), then walks the commander tree
 * WITHOUT parsing argv — no command action ever runs.
 *
 * Run from repo root: `bun scripts/parity/extract-cli.ts`
 * Output: `scripts/parity/out/cli.json`
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Command, Command as CommanderCommand } from "commander";
import {
	registerBackupCommand,
	registerBootstrapCommand,
	registerCodegenCommand,
	registerConfigCommand,
	registerConsoleCommand,
	registerContextCommand,
	registerCreditsCommand,
	registerDevnetCommand,
	registerDoctorCommand,
	registerIndexCommand,
	registerInitCommand,
	registerLocalCommand,
	registerLoginCommand,
	registerLogoutCommand,
	registerObserverCommand,
	registerRepairCommand,
	registerRestoreCommand,
	registerStartCommand,
	registerStatusCommand,
	registerStreamsCommand,
	registerSubgraphsCommand,
	registerSubscriptionsCommand,
	registerUninstallCommand,
	registerVerifyCommand,
	registerWhoamiCommand,
} from "../../packages/cli/src/commands/index.ts";

interface ParityItem {
	id: string;
	group: string;
	description: string;
	hidden: boolean;
}

interface ParitySurface {
	surface: "cli";
	generatedFrom: string[];
	items: ParityItem[];
}

function buildProgram(): Command {
	const program = new CommanderCommand()
		.name("secondlayer")
		.alias("sl")
		.description("Secondlayer CLI — run a Stacks index on your own hardware");

	// Mirror of the registration order in packages/cli/src/cli.ts.
	registerInitCommand(program);
	registerBootstrapCommand(program);
	registerObserverCommand(program);
	registerStartCommand(program);
	registerConsoleCommand(program);
	registerLoginCommand(program);
	registerLogoutCommand(program);
	registerWhoamiCommand(program);
	registerSubgraphsCommand(program);
	registerSubscriptionsCommand(program);
	registerStreamsCommand(program);
	registerIndexCommand(program);
	registerCodegenCommand(program);
	registerLocalCommand(program);
	registerDevnetCommand(program);
	registerStatusCommand(program);
	registerDoctorCommand(program);
	registerConfigCommand(program);
	registerContextCommand(program);
	registerVerifyCommand(program);
	registerRepairCommand(program);
	registerBackupCommand(program);
	registerRestoreCommand(program);
	registerUninstallCommand(program);
	registerCreditsCommand(program);

	return program;
}

/** Commander keeps hidden state on the private `_hidden` field. */
function isHidden(cmd: Command): boolean {
	return (cmd as unknown as { _hidden?: boolean })._hidden === true;
}

/**
 * A command with an action handler is itself invokable, even when it also has
 * subcommands (e.g. `streams events` lists events AND hosts `events by-tx`).
 * Commander stores the handler on the private `_actionHandler` field.
 */
function hasAction(cmd: Command): boolean {
	return (
		(cmd as unknown as { _actionHandler?: unknown })._actionHandler != null
	);
}

function collectLeaves(
	cmd: Command,
	path: string[],
	parentHidden: boolean,
	items: ParityItem[],
): void {
	for (const sub of cmd.commands) {
		const subPath = [...path, sub.name()];
		const hidden = parentHidden || isHidden(sub);
		if (sub.commands.length === 0 || hasAction(sub)) {
			const id = subPath.join(" ");
			items.push({
				id,
				group: subPath[0] ?? "",
				description: sub.description(),
				hidden,
			});
		}
		if (sub.commands.length > 0) {
			collectLeaves(sub, subPath, hidden, items);
		}
	}
}

const program = buildProgram();
const items: ParityItem[] = [];
collectLeaves(program, [], false, items);

const duplicates = items
	.map((item) => item.id)
	.filter((id, i, ids) => ids.indexOf(id) !== i);
if (duplicates.length > 0) {
	throw new Error(`duplicate command ids: ${duplicates.join(", ")}`);
}

const surface: ParitySurface = {
	surface: "cli",
	generatedFrom: [
		"packages/cli/src/cli.ts",
		"packages/cli/src/commands/index.ts",
	],
	items,
};

const outDir = join(dirname(fileURLToPath(import.meta.url)), "out");
await mkdir(outDir, { recursive: true });
const outFile = join(outDir, "cli.json");
await Bun.write(outFile, `${JSON.stringify(surface, null, "\t")}\n`);

const groups = new Set(items.map((item) => item.group));
const hiddenCount = items.filter((item) => item.hidden).length;
console.log(
	`cli surface: ${items.length} leaf commands across ${groups.size} groups (${hiddenCount} hidden) → scripts/parity/out/cli.json`,
);
