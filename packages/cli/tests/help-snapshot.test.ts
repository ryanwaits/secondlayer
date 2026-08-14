import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { registerAccountCommand } from "../src/commands/account.ts";
import { registerBootstrapCommand } from "../src/commands/bootstrap.ts";
import { registerInitCommand } from "../src/commands/init.ts";
import { registerKeysCommand } from "../src/commands/keys.ts";
import { registerLoginCommand } from "../src/commands/login.ts";
import { registerObserverCommand } from "../src/commands/observer.ts";
import { registerProjectCommand } from "../src/commands/project.ts";

/**
 * DX acceptance: top-level help shows init/bootstrap/observer and hides
 * hosted login / account / keys / projects.
 */
describe("CLI help snapshot", () => {
	test("init, bootstrap, and observer are listed; hosted auth is hidden", () => {
		const program = new Command().name("sl");
		registerInitCommand(program);
		registerBootstrapCommand(program);
		registerObserverCommand(program);
		registerLoginCommand(program);
		registerAccountCommand(program);
		registerKeysCommand(program);
		registerProjectCommand(program);

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
});
