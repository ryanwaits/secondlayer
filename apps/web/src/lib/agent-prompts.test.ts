import { describe, expect, test } from "bun:test";
import { AGENT_PROMPTS, AGENT_SETUP, getAgentPrompt } from "./agent-prompts";

describe("agent prompt registry", () => {
	test("all prompts include setup once", () => {
		for (const prompt of AGENT_PROMPTS) {
			const text = getAgentPrompt(prompt.id);
			expect(text.includes(AGENT_SETUP)).toBe(true);
			expect(text.match(/bunx skills add/g)?.length).toBe(1);
		}
	});

	test("subscription prompt uses contextual subgraph and tables", () => {
		const text = getAgentPrompt("subscription-create", {
			subgraphName: "alex-swaps",
			tables: ["swaps", "traders"],
		});
		expect(text).toContain('"alex-swaps"');
		expect(text).toContain("`swaps`");
		expect(text).toContain("`traders`");
		expect(text).toContain("ask me only for the receiver runtime");
	});

	test("test fixture prompt forbids stored secret recovery and posting", () => {
		const text = getAgentPrompt("subscription-test", {
			subscriptionName: "whale-alerts",
			subscriptionId: "sub-1",
		});
		expect(text).toContain("whale-alerts");
		expect(text).toContain(
			"never request or recover the stored platform secret",
		);
		expect(text).toContain("Do not POST");
	});
});
