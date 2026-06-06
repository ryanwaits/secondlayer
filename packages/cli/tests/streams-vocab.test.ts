import { describe, expect, it } from "bun:test";
import { STREAMS_EVENT_TYPES } from "@secondlayer/shared";
import { VALID_TYPES } from "../src/commands/streams.ts";

// Guards against the CLI re-hardcoding a stale subset of the Streams event vocab.
// VALID_TYPES must stay sourced from @secondlayer/shared so `sl streams` accepts
// (and its help advertises) exactly the types the API supports.
describe("cli streams vocab ↔ shared", () => {
	it("accepts exactly the shared Streams event types", () => {
		expect([...VALID_TYPES]).toEqual([...STREAMS_EVENT_TYPES]);
	});
});
