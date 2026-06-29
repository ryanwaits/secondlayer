import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildSubscriptionAuthConfig,
	parseTriggersInput,
} from "../src/commands/create.ts";

describe("create subscription tenant resolution", () => {
	it("builds bearer auth config from --auth-token", () => {
		expect(buildSubscriptionAuthConfig(" tr_secret_abc ")).toEqual({
			authType: "bearer",
			token: "tr_secret_abc",
		});
		expect(buildSubscriptionAuthConfig()).toBeUndefined();
		expect(() => buildSubscriptionAuthConfig("   ")).toThrow(
			"--auth-token must not be empty",
		);
	});
});

describe("parseTriggersInput", () => {
	it("parses repeatable inline --trigger JSON into validated triggers", () => {
		const triggers = parseTriggersInput({
			trigger: ['{"type":"sbtc_deposit"}', '{"type":"contract_call"}'],
		});
		expect(triggers).toEqual([
			{ type: "sbtc_deposit" },
			{ type: "contract_call" },
		]);
	});

	it("parses a --triggers-file JSON array", () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-triggers-"));
		const file = join(dir, "triggers.json");
		writeFileSync(file, JSON.stringify([{ type: "sbtc_withdrawal_accept" }]));
		expect(parseTriggersInput({ triggersFile: file })).toEqual([
			{ type: "sbtc_withdrawal_accept" },
		]);
	});

	it("merges file and inline triggers", () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-triggers-"));
		const file = join(dir, "triggers.json");
		writeFileSync(file, JSON.stringify([{ type: "sbtc_deposit" }]));
		expect(
			parseTriggersInput({
				triggersFile: file,
				trigger: ['{"type":"stx_transfer"}'],
			}),
		).toEqual([{ type: "sbtc_deposit" }, { type: "stx_transfer" }]);
	});

	it("throws on invalid JSON", () => {
		expect(() => parseTriggersInput({ trigger: ["{not json}"] })).toThrow(
			/not valid JSON/,
		);
	});

	it("throws on an unknown trigger type", () => {
		expect(() => parseTriggersInput({ trigger: ['{"type":"nope"}'] })).toThrow(
			/Invalid trigger at index 0/,
		);
	});

	it("throws when no triggers are provided", () => {
		expect(() => parseTriggersInput({})).toThrow(/at least one --trigger/);
	});

	it("throws when --triggers-file is not a JSON array", () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-triggers-"));
		const file = join(dir, "bad.json");
		writeFileSync(file, JSON.stringify({ type: "sbtc_deposit" }));
		expect(() => parseTriggersInput({ triggersFile: file })).toThrow(
			/must contain a JSON array/,
		);
	});
});
