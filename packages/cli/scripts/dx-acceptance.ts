/**
 * DX acceptance: sl --help lists init/bootstrap/observer and does not
 * advertise hosted login/account/billing/keys/projects.
 *
 *   bun packages/cli/scripts/dx-acceptance.ts
 */
import { Command } from "commander";
import { registerAccountCommand } from "../src/commands/account.ts";
import { registerBootstrapCommand } from "../src/commands/bootstrap.ts";
import { registerInitCommand } from "../src/commands/init.ts";
import { registerKeysCommand } from "../src/commands/keys.ts";
import { registerLoginCommand } from "../src/commands/login.ts";
import { registerObserverCommand } from "../src/commands/observer.ts";
import { registerProjectCommand } from "../src/commands/project.ts";

const program = new Command().name("sl");
registerInitCommand(program);
registerBootstrapCommand(program);
registerObserverCommand(program);
registerLoginCommand(program);
registerAccountCommand(program);
registerKeysCommand(program);
registerProjectCommand(program);

const help = program.helpInformation();
const must = ["init", "bootstrap", "observer"];
const mustNot = ["instance", "login", "account", "keys", "projects"];
const missing = must.filter((w) => !new RegExp(`^\\s+${w}\\b`, "m").test(help));
const leaked = mustNot.filter((w) =>
	new RegExp(`^\\s+${w}\\b`, "m").test(help),
);
if (missing.length || leaked.length) {
	console.error("DX acceptance failed");
	if (missing.length) console.error("missing:", missing.join(", "));
	if (leaked.length) console.error("leaked:", leaked.join(", "));
	process.exit(1);
}
console.log("DX acceptance ok");
