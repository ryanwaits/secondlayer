import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { registerCreditsCommand, rowsUsageDays } from "./credits.ts";

describe("secondlayer credits", () => {
	test("registers buy and balance", () => {
		const program = new Command();
		registerCreditsCommand(program);
		const credits = program.commands.find((c) => c.name() === "credits");
		expect(credits).toBeDefined();
		const names = (credits?.commands ?? []).map((c) => c.name());
		expect(names).toContain("buy");
		expect(names).toContain("balance");
		expect(names).toContain("refill");
		expect(names).toContain("usage");
	});

	test("usage defaults to 30 days and offers --json", () => {
		const program = new Command();
		registerCreditsCommand(program);
		const usage = program.commands
			.find((c) => c.name() === "credits")
			?.commands.find((c) => c.name() === "usage");
		const flags = (usage?.options ?? []).map((o) => o.long);
		expect(flags).toEqual(["--days", "--json"]);
		expect(usage?.options[0]?.defaultValue).toBe("30");
	});
});

describe("rowsUsageDays", () => {
	const now = new Date("2026-10-15T12:00:00.000Z");
	const day = (
		date: string,
		source: string,
		freeRows: number,
		paidRows: number,
	) => ({ date, source, rows: freeRows + paidRows, freeRows, paidRows });

	test("sums sources per day, zero-fills quiet days and ends today", () => {
		const lines = rowsUsageDays(
			[
				day("2026-10-14", "index", 10, 0),
				day("2026-10-14", "streams", 5, 2),
				day("2026-10-15", "index", 0, 7),
			],
			3,
			now,
		);
		expect(lines).toEqual([
			{ date: "2026-10-13", rows: 0, free: 0, paid: 0 },
			{ date: "2026-10-14", rows: 17, free: 15, paid: 2 },
			{ date: "2026-10-15", rows: 7, free: 0, paid: 7 },
		]);
	});
});
