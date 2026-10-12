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

	test("create prompt asks for triggers and a receiver URL, not a subgraph", () => {
		const text = getAgentPrompt("webhook-create");
		expect(text).toContain("which chain events to match");
		expect(text).toContain("secondlayer webhooks create");
		expect(text).not.toContain("subgraph");
	});

	test("chainhook migration prompt reads the webhooks page and names every trigger", () => {
		const text = getAgentPrompt("migrate-from-chainhook");
		expect(text).toContain("secondlayer.tools/docs/webhooks.md");
		expect(text).toContain("secondlayer webhooks create");
		for (const name of [
			"contractCall",
			"printEvent",
			"ftMint",
			"ftTransfer",
			"ftBurn",
			"nftMint",
			"nftTransfer",
			"nftBurn",
			"stxMint",
			"stxTransfer",
			"stxLock",
			"contractDeploy",
		]) {
			expect(text).toContain(`trigger.${name}`);
		}
		expect(text).not.toContain("—");
	});

	test("test fixture prompt forbids stored secret recovery and posting", () => {
		const text = getAgentPrompt("webhook-test", {
			webhookName: "whale-alerts",
			webhookId: "sub-1",
		});
		expect(text).toContain("whale-alerts");
		expect(text).toContain(
			"never request or recover the stored platform secret",
		);
		expect(text).toContain("Do not POST");
	});
});
