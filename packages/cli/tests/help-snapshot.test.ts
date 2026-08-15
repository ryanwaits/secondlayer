import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { registerBootstrapCommand } from "../src/commands/bootstrap.ts";
import { registerInitCommand } from "../src/commands/init.ts";
import { registerLoginCommand } from "../src/commands/login.ts";
import { registerObserverCommand } from "../src/commands/observer.ts";

/**
 * DX acceptance: top-level help shows init/bootstrap/observer and hides the
 * hosted login verb; retired hosted verbs (instance/account/keys/projects)
 * never reappear.
 */
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
});
