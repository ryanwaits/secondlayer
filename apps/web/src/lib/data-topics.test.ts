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

	test("keyed samples read the key from the environment, never carry one", () => {
		for (const topic of DATA_TOPICS) {
			expect(topic.examples.curl.code).toContain("$SECONDLAYER_API_KEY");
			expect(topic.examples.ts.code).toContain(
				"process.env.SECONDLAYER_API_KEY",
			);
			expect(text(topic)).not.toMatch(/sk-sl_[A-Za-z0-9]/);
		}
	});

	test("the keyless command is the one hosted aggregate the page reads", () => {
		for (const topic of DATA_TOPICS)
			expect(topic.examples.free.code).toContain(
				`https://api.secondlayer.tools/public/data/${topic.stats}`,
			);
	});

	test("every topic offers exactly three recipes with a call and its output", () => {
		for (const topic of DATA_TOPICS) {
			expect(topic.recipes).toHaveLength(3);
			for (const recipe of topic.recipes) {
				expect(recipe.code).toContain("await sl.index.");
				expect(recipe.output.length).toBeGreaterThan(0);
			}
		}
	});

	test("recipes handle a missing record instead of destructuring it", () => {
		for (const topic of DATA_TOPICS)
			for (const recipe of topic.recipes)
				if (/\.get\(/.test(recipe.code))
					expect(recipe.code).not.toMatch(
						/const \{[^}]*\} = await [^;]*\.get\(/,
					);
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
