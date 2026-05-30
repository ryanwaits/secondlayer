import { describe, expect, test } from "bun:test";
import {
	isValidatedStreamsDbEventType,
	validateStreamsEventPayload,
} from "./streams-payload-schema.ts";

describe("validateStreamsEventPayload", () => {
	test("accepts well-formed payloads", () => {
		expect(
			validateStreamsEventPayload("ft_transfer_event", {
				asset_identifier: "SP1.token::tok",
				sender: "SP1",
				recipient: "SP2",
				amount: "100",
			}),
		).toBeNull();
		expect(
			validateStreamsEventPayload("nft_mint_event", {
				asset_identifier: "SP1.coll::id",
				recipient: "SP2",
				value: { hex: "0x01" },
			}),
		).toBeNull();
		expect(
			validateStreamsEventPayload("smart_contract_event", {
				contract_identifier: "SP1.contract",
				topic: "print",
				value: { repr: "u1" },
			}),
		).toBeNull();
	});

	test("flags a missing required string field", () => {
		expect(
			validateStreamsEventPayload("stx_transfer_event", {
				sender: "SP1",
				amount: "5",
			}),
		).toBe("missing or non-string field: recipient");
	});

	test("flags a non-string field", () => {
		expect(
			validateStreamsEventPayload("stx_mint_event", {
				recipient: "SP2",
				amount: 5,
			}),
		).toBe("missing or non-string field: amount");
	});

	test("flags a missing Clarity value", () => {
		expect(
			validateStreamsEventPayload("nft_transfer_event", {
				asset_identifier: "SP1.coll::id",
				sender: "SP1",
				recipient: "SP2",
			}),
		).toBe("missing field: value");
	});

	test("flags a non-object payload", () => {
		expect(validateStreamsEventPayload("stx_burn_event", null)).toBe(
			"payload is not an object",
		);
	});

	test("does not validate non-Streams event types", () => {
		expect(isValidatedStreamsDbEventType("ft_transfer_event")).toBe(true);
		expect(isValidatedStreamsDbEventType("some_other_event")).toBe(false);
		expect(validateStreamsEventPayload("some_other_event", null)).toBeNull();
	});
});
