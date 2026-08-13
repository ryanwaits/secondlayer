import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { registerAccountCommand } from "../src/commands/account.ts";
import { registerInstanceCommand } from "../src/commands/instance.ts";
import { registerKeysCommand } from "../src/commands/keys.ts";
import { registerLoginCommand } from "../src/commands/login.ts";
import { registerProjectCommand } from "../src/commands/project.ts";

/**
 * DX acceptance: top-level help shows instance init/bootstrap and hides
 * hosted login / account / keys / projects.
 */
describe("CLI help snapshot", () => {
	test("instance commands are listed; hosted auth is hidden", () => {
		const program = new Command().name("sl");
		registerInstanceCommand(program);
		registerLoginCommand(program);
		registerAccountCommand(program);
		registerKeysCommand(program);
		registerProjectCommand(program);

		const help = program.helpInformation();
		expect(help).toContain("instance");
		expect(help).not.toMatch(/^\s+login\b/m);
		expect(help).not.toMatch(/^\s+account\b/m);
		expect(help).not.toMatch(/^\s+keys\b/m);
		expect(help).not.toMatch(/^\s+projects\b/m);

		const instance = program.commands.find((c) => c.name() === "instance");
		expect(instance).toBeTruthy();
		const names = instance?.commands.map((c) => c.name()) ?? [];
		expect(names).toEqual(
			expect.arrayContaining(["init", "bootstrap", "observer"]),
		);
	});
});
