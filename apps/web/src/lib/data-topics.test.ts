import { describe, expect, test } from "bun:test";
import {
	DATA_TOPICS,
	dataPath,
	dataTopic,
	liveDataTopics,
} from "./data-topics";

const text = (topic: (typeof DATA_TOPICS)[number]) => JSON.stringify(topic);

describe("data topics", () => {
	test("slugs are unique", () => {
		const slugs = DATA_TOPICS.map((topic) => topic.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
	});

	test("only live topics resolve", () => {
		for (const topic of DATA_TOPICS)
			expect(dataTopic(topic.slug)).toBe(topic.live ? topic : undefined);
		expect(dataTopic("nope")).toBeUndefined();
		expect(liveDataTopics().map(dataPath)).toEqual(
			DATA_TOPICS.filter((topic) => topic.live).map(
				(topic) => `/data/${topic.slug}`,
			),
		);
	});

	test("the sample response is real JSON", () => {
		for (const topic of DATA_TOPICS)
			expect(() => JSON.parse(topic.sampleResponse)).not.toThrow();
	});

	test("samples carry the placeholder key, never a real one", () => {
		for (const topic of DATA_TOPICS) {
			expect(topic.curl).toContain("Bearer sk-sl_…");
			expect(text(topic)).not.toMatch(/sk-sl_[A-Za-z0-9]/);
		}
	});

	test("copy keeps the house voice", () => {
		for (const topic of DATA_TOPICS) {
			expect(text(topic)).not.toContain("—");
			expect(text(topic)).not.toMatch(/hiro|your agent|rpc provider/i);
			expect(topic.title.length).toBeLessThanOrEqual(60);
			expect(topic.description.length).toBeLessThanOrEqual(160);
		}
	});

	test("links point at docs anchors or the stacks library", () => {
		for (const topic of DATA_TOPICS) {
			expect(topic.docsHref).toStartWith("/docs/index#");
			expect(topic.apiHref).toStartWith("/docs/api/index#");
			if (topic.libraryHref)
				expect(topic.libraryHref).toStartWith(
					"https://stacks.secondlayer.tools/",
				);
		}
	});
});
