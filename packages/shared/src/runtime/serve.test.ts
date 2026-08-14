import { describe, expect, test } from "bun:test";
import { MODULE_COMMANDS, commandFor } from "./commands.ts";
import { DEFAULT_PROFILE } from "./modules.ts";

describe("one-box commands", () => {
	test("every default module has a command; publisher is separate", () => {
		for (const id of DEFAULT_PROFILE) {
			expect(commandFor(id)[0]).toBe("bun");
		}
		expect(MODULE_COMMANDS.publisher.join(" ")).toContain("streams-bulk");
	});
});
