import { Command } from "commander";
import { registerProjectCommand } from "../../src/commands/project.ts";

const program = new Command();
program.name("test-sl");
registerProjectCommand(program);

await program.parseAsync(process.argv);
