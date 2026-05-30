import { describe, expect, test } from "bun:test";
import type { StreamsEvent } from "../index.ts";

// Compile-time assertions: tsc validates that `event_type` narrows `payload`.
// The `@ts-expect-error` lines fail the build if narrowing ever regresses to a
// loose `Record<string, unknown>`.
describe("StreamsEvent discriminated union narrowing", () => {
	test("event_type narrows payload to the matching shape", () => {
		const events: StreamsEvent[] = [];
		for (const event of events) {
			if (event.event_type === "ft_transfer") {
				const amount: string = event.payload.amount;
				const asset: string = event.payload.asset_identifier;
				void amount;
				void asset;
				// @ts-expect-error topic belongs to print payloads, not ft_transfer
				void event.payload.topic;
			}
			if (event.event_type === "print") {
				const topic: string | undefined = event.payload.topic;
				void topic;
				// @ts-expect-error amount is not part of a print payload
				void event.payload.amount;
			}
			if (event.event_type === "nft_transfer") {
				const value = event.payload.value;
				void value;
			}
		}
		expect(events).toEqual([]);
	});
});
