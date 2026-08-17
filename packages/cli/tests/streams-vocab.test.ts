import { describe, expect, it } from "bun:test";
import { STREAMS_EVENT_TYPES } from "@secondlayer/shared";
import { Command } from "commander";
import {
	VALID_TYPES,
	registerStreamsCommand,
} from "../src/commands/streams.ts";

// Guards against the CLI re-hardcoding a stale subset of the Streams event vocab.
// VALID_TYPES must stay sourced from @secondlayer/shared so `sl streams` accepts
// (and its help advertises) exactly the types the API supports.
describe("cli streams vocab ↔ shared", () => {
	it("accepts exactly the shared Streams event types", () => {
		expect([...VALID_TYPES]).toEqual([...STREAMS_EVENT_TYPES]);
	});
});

describe("cli streams command surface", () => {
	it("downloads bulk dumps under `dumps`, with `pull` removed", () => {
		const program = new Command();
		registerStreamsCommand(program);
		const streams = program.commands.find((c) => c.name() === "streams");
		const dumps = streams?.commands.find((c) => c.name() === "dumps");

		expect(dumps).toBeDefined();
		expect(dumps?.options.map((o) => o.long).sort()).toEqual([
			"--dumps-url",
			"--from-block",
			"--to",
			"--to-block",
		]);
		expect(
			streams?.commands.flatMap((c) => [c.name(), ...c.aliases()]),
		).not.toContain("pull");
	});
});
