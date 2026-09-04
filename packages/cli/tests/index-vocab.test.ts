import { describe, expect, it } from "bun:test";
import { DECODED_EVENT_TYPES } from "@secondlayer/shared";
import { Command } from "commander";
import {
	VALID_INDEX_TYPES,
	parseIndexEventType,
	registerIndexCommand,
} from "../src/commands/index-api.ts";

// Guards against the CLI re-hardcoding a stale subset of the Index event vocab.
// VALID_INDEX_TYPES must stay sourced from @secondlayer/shared so `sl index events`
// accepts (and its help advertises) exactly the types the API supports.
describe("cli index vocab ↔ shared", () => {
	it("accepts exactly the shared decoded event types", () => {
		expect([...VALID_INDEX_TYPES]).toEqual([...DECODED_EVENT_TYPES]);
	});

	it("lists every decoded event type on `index events --help`", () => {
		const program = new Command();
		registerIndexCommand(program);
		const events = program.commands
			.find((c) => c.name() === "index")
			?.commands.find((c) => c.name() === "events");
		const eventType = events?.options.find((o) => o.long === "--event-type");
		expect(eventType?.description).toBeDefined();
		for (const type of DECODED_EVENT_TYPES) {
			expect(eventType?.description).toContain(type);
		}
	});
});

describe("parseIndexEventType", () => {
	it("accepts a valid type from either flag", () => {
		expect(parseIndexEventType("print")).toBe("print");
		expect(parseIndexEventType(undefined, "ft_transfer")).toBe("ft_transfer");
		expect(parseIndexEventType("  stx_lock  ")).toBe("stx_lock");
	});

	it("requires one type", () => {
		expect(() => parseIndexEventType()).toThrow(/--event-type is required/);
		expect(() => parseIndexEventType("")).toThrow(/--event-type is required/);
		expect(() => parseIndexEventType("   ")).toThrow(
			/--event-type is required/,
		);
	});

	it("refuses both flags, a comma list, and an unknown type", () => {
		expect(() => parseIndexEventType("print", "ft_transfer")).toThrow(
			/--event-type and --types are mutually exclusive/,
		);
		expect(() => parseIndexEventType("stx_transfer,print")).toThrow(
			/ONE value/,
		);
		expect(() => parseIndexEventType("print_event")).toThrow(
			/invalid --event-type "print_event"/,
		);
	});
});
