import type { Command } from "commander";
import { registerDeleteCommand } from "./delete.ts";
import { registerGetCommand } from "./get.ts";
import { registerListCommand } from "./list.ts";
import { registerLogsCommand } from "./logs.ts";
import { registerNewCommand } from "./new.ts";
import { registerRegisterCommand } from "./register.ts";
import { registerReplayCommand } from "./replay.ts";
import { registerRotateSecretCommand } from "./rotate-secret.ts";
import { registerSetCommand } from "./set.ts";

export function registerStreamsCommand(program: Command): void {
	const streams = program
		.command("streams")
		.description("[DEPRECATED] Manage event streams — use 'workflows' instead");

	// Show deprecation warning on every streams subcommand
	streams.hook("preAction", () => {
		console.error(
			"\n⚠️  WARNING: 'sl streams' is deprecated and will be removed in v2.0.",
		);
		console.error(
			"   Migrate to Workflows: sl workflows create --template=simple-webhook\n",
		);
	});

	registerNewCommand(streams);
	registerListCommand(streams);
	registerGetCommand(streams);
	registerRegisterCommand(streams);
	registerDeleteCommand(streams);
	registerSetCommand(streams);
	registerLogsCommand(streams);
	registerReplayCommand(streams);
	registerRotateSecretCommand(streams);
}
