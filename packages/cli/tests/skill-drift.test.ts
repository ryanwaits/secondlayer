import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

function readTree(dir: string): string {
	return readdirSync(dir)
		.flatMap((entry) => {
			const path = join(dir, entry);
			if (statSync(path).isDirectory()) return readTree(path);
			if (!path.endsWith(".md") && !path.endsWith(".yaml")) return "";
			return readFileSync(path, "utf8");
		})
		.join("\n");
}

describe("secondlayer skill drift", () => {
	const skillDir = join(root, "skills/secondlayer");
	const skillCorpus = readTree(skillDir);
	const promptRegistry = readFileSync(
		join(root, "apps/web/src/lib/agent-prompts.ts"),
		"utf8",
	);

	test("skill frontmatter is lean", () => {
		const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
		const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
		expect(frontmatter).toContain("name:");
		expect(frontmatter).toContain("description:");
		expect(frontmatter).not.toContain("metadata:");
		expect(frontmatter).not.toContain("license:");
		expect(skill.split("\n").length).toBeLessThanOrEqual(200);
	});

	test("skill and prompts mention current subscription lifecycle surface", () => {
		const corpus = `${skillCorpus}\n${promptRegistry}`;
		for (const term of [
			"pause",
			"resume",
			"rotate-secret",
			"deliveries",
			"dead",
			"requeue",
			"replay",
			"doctor",
			"test",
		]) {
			expect(corpus).toContain(term);
		}
	});

	test("stale skill commands and source shapes stay out", () => {
		expect(skillCorpus).not.toContain("secondlayer auth login");
		expect(skillCorpus).not.toContain("npx secondlayer");
		expect(skillCorpus).not.toContain("subgraph create");
		expect(skillCorpus).not.toContain("sources: [");
	});
});
