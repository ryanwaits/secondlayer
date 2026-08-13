/**
 * DX acceptance: sl --help lists instance init/bootstrap and does not
 * advertise hosted login/account/billing/keys/projects.
 *
 *   bun packages/cli/scripts/dx-acceptance.ts
 */
import { Command } from "commander";
import { registerAccountCommand } from "../src/commands/account.ts";
import { registerInstanceCommand } from "../src/commands/instance.ts";
import { registerKeysCommand } from "../src/commands/keys.ts";
import { registerLoginCommand } from "../src/commands/login.ts";
import { registerProjectCommand } from "../src/commands/project.ts";

const program = new Command().name("sl");
registerInstanceCommand(program);
registerLoginCommand(program);
registerAccountCommand(program);
registerKeysCommand(program);
registerProjectCommand(program);

const help = program.helpInformation();
const must = ["instance"];
const mustNot = ["login", "account", "keys", "projects"];
const missing = must.filter((w) => !help.includes(w));
const leaked = mustNot.filter((w) =>
	new RegExp(`^\\s+${w}\\b`, "m").test(help),
);
if (missing.length || leaked.length) {
	console.error("DX acceptance failed");
	if (missing.length) console.error("missing:", missing.join(", "));
	if (leaked.length) console.error("leaked:", leaked.join(", "));
	process.exit(1);
}
const names =
	program.commands
		.find((c) => c.name() === "instance")
		?.commands.map((c) => c.name()) ?? [];
for (const cmd of ["init", "bootstrap", "observer"]) {
	if (!names.includes(cmd)) {
		console.error(`missing sl instance ${cmd}`);
		process.exit(1);
	}
}
console.log("DX acceptance ok");
