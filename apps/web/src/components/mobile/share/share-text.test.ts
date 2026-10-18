import { describe, expect, test } from "bun:test";
import type { Insight } from "@/lib/insights";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import {
	SHARE_TARGETS,
	type ShareTarget,
	buildShareText,
	shareUrl,
} from "./share-text";

const base = FIXTURE_INSIGHTS.find(
	(i) => i.rule === "receiver_down",
) as Insight;
const DASHBOARD = "https://secondlayer.tools/account/webhooks/wh-deposits";
const targets = Object.keys(SHARE_TARGETS) as ShareTarget[];

const withConfidence = (confidence: number): Insight => ({
	...base,
	how: {
		...base.how,
		label: { cause: "The load balancer has no healthy servers.", confidence },
	},
});

const query = (url: string) =>
	decodeURIComponent(url.slice(url.indexOf("=") + 1));

describe("buildShareText", () => {
	test("carries the meta, every check command and ends with the dashboard link", () => {
		const { text, title } = buildShareText(base);
		expect(title).toBe(base.lead);
		expect(text).toContain(base.meta as string);
		for (const command of base.handoff.commands) {
			expect(text).toContain(`Check: ${command}`);
		}
		expect(text.endsWith(DASHBOARD)).toBe(true);
	});

	test("names a likely cause only at confidence 0.85 or more", () => {
		expect(buildShareText(withConfidence(0.9)).text).toContain("Likely cause:");
		expect(buildShareText(withConfidence(0.6)).text).not.toContain(
			"Likely cause:",
		);
	});

	test("names keys and calls, never an agent of the customer's", () => {
		const phrase = ["your", "agent"].join(" ");
		const text = buildShareText(base).text.toLowerCase();
		expect(text).not.toContain(phrase);
		for (const target of targets) {
			expect(shareUrl(target, base).toLowerCase()).not.toContain(
				"your%20agent",
			);
		}
	});
});

describe("shareUrl", () => {
	test("percent-encodes spaces, ampersands and newlines", () => {
		const url = shareUrl("claude", { ...base, meta: "a b&c" });
		expect(url.startsWith("https://claude.ai/new?q=")).toBe(true);
		expect(url).toContain("a%20b%26c");
		expect(url).toContain("%0A");
	});

	test("stays within 8,000 characters and keeps the link for a huge prompt", () => {
		const huge: Insight = {
			...base,
			handoff: { ...base.handoff, prompt: "x".repeat(20_000) },
		};
		for (const target of targets) {
			const url = shareUrl(target, huge);
			expect(url.length).toBeLessThanOrEqual(8000);
			expect(query(url).endsWith(DASHBOARD)).toBe(true);
		}
	});

	test("drops the prompt and checks when even an empty prompt is too long", () => {
		const commands = Array.from(
			{ length: 400 },
			(_, i) => `sl webhooks doctor wh-${i}`,
		);
		const url = shareUrl("cursor", {
			...base,
			handoff: { prompt: "p", commands },
		});
		expect(url.length).toBeLessThanOrEqual(8000);
		expect(query(url).endsWith(DASHBOARD)).toBe(true);
		expect(query(url)).not.toContain("Check:");
	});
});
