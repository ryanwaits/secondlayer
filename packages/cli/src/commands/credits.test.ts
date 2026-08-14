import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { registerCreditsCommand } from "./credits.ts";

describe("sl credits", () => {
	test("registers buy and balance", () => {
		const program = new Command();
		registerCreditsCommand(program);
		const credits = program.commands.find((c) => c.name() === "credits");
		expect(credits).toBeDefined();
		const names = (credits?.commands ?? []).map((c) => c.name());
		expect(names).toContain("buy");
		expect(names).toContain("balance");
		expect(names).toContain("refill");
	});
});
