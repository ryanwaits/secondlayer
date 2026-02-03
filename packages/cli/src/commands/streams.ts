import { Command } from "commander";
import { registerNewCommand } from "./new.ts";
import { registerListCommand } from "./list.ts";
import { registerGetCommand } from "./get.ts";
import { registerRegisterCommand } from "./register.ts";
import { registerDeleteCommand } from "./delete.ts";
import { registerSetCommand } from "./set.ts";
import { registerLogsCommand } from "./logs.ts";
import { registerReplayCommand } from "./replay.ts";
import { registerRotateSecretCommand } from "./rotate-secret.ts";

export function registerStreamsCommand(program: Command): void {
  const streams = program
    .command("streams")
    .description("Manage event streams");

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
