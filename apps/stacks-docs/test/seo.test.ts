import { expect, test } from "bun:test";
import { Glob } from "bun";
import { routeOf, sitemap } from "../scripts/sitemap";

const pagesDir = new URL("../docs/pages/", import.meta.url).pathname;
const files = [...new Glob("**/*.mdx").scanSync(pagesDir)].sort();
const read = (file: string) => Bun.file(`${pagesDir}${file}`).text();

function description(source: string): string | undefined {
	const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)?.[1];
	if (!frontmatter) return undefined;
	return (Bun.YAML.parse(frontmatter) as { description?: string }).description;
}

test("every page has a frontmatter description of 155 characters or fewer", async () => {
	expect(files.length).toBeGreaterThanOrEqual(30);
	for (const file of files) {
		const text = description(await read(file));
		expect(text, file).toBeString();
		expect(text?.length, file).toBeLessThanOrEqual(155);
	}
});

test("pages contain no em dashes", async () => {
	for (const file of files) expect(await read(file), file).not.toContain("—");
});

test("pages link the www host, never the apex", async () => {
	for (const file of files)
		expect(await read(file), file).not.toContain("https://secondlayer.tools");
});

test("robots.txt allows crawling and names the sitemap", async () => {
	const robots = await Bun.file(
		new URL("../docs/public/robots.txt", import.meta.url),
	).text();
	expect(robots).toContain("Allow: /");
	expect(robots).toContain(
		"Sitemap: https://stacks.secondlayer.tools/sitemap.xml",
	);
});

test("sitemap maps page files to routes", () => {
	expect(routeOf("index.mdx")).toBe("/");
	expect(routeOf("guide/pox5.mdx")).toBe("/guide/pox5");
	expect(sitemap(["index.mdx", "guide/pox5.mdx"])).toContain(
		"<loc>https://stacks.secondlayer.tools/guide/pox5</loc>",
	);
});
