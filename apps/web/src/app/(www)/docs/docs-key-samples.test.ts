import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A signed-in reader's docs key fills a sample only where the sample names the
 * credential (`process.env.SECONDLAYER_API_KEY` in an SDK sample). A sample that
 * builds the client without `apiKey` has nowhere for the key to go, so every
 * client construction a reader can copy must pass it.
 */
const DOCS = import.meta.dir;
const REFERENCE = join(DOCS, "../../../generated/reference/sdk");
const EXAMPLES = join(DOCS, "../../../../../../packages/sdk/examples");
/** Release notes quote code as it was. */
const EXEMPT = new Set(["changelog/page.mdx"]);

const FENCE = /^(`{3,}|~{3,})(\w*)[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm;
const SDK_LANGS = new Set(["ts", "tsx", "typescript", "js", "javascript"]);

/** Each `new SecondLayer(...)` call that passes no `apiKey`, by its first line. */
function keyless(code: string): string[] {
	const found: string[] = [];
	for (let at = code.indexOf("new SecondLayer("); at >= 0; ) {
		const end = code.indexOf(")", at);
		const call = code.slice(at, end + 1);
		if (!/\bapiKey\s*:/.test(call)) found.push(call.split("\n")[0] ?? call);
		at = code.indexOf("new SecondLayer(", at + 1);
	}
	return found;
}

function files(dir: string, ext: string): string[] {
	return readdirSync(dir, { recursive: true, encoding: "utf8" })
		.filter((f) => f.endsWith(ext))
		.map((f) => join(dir, f));
}

describe("docs key samples", () => {
	test("every SDK sample in the docs passes apiKey to the client", () => {
		const misses: string[] = [];
		for (const file of files(DOCS, ".mdx")) {
			const rel = relative(DOCS, file);
			if (EXEMPT.has(rel)) continue;
			for (const m of readFileSync(file, "utf8").matchAll(FENCE))
				if (SDK_LANGS.has(m[2] ?? ""))
					for (const call of keyless(m[3] ?? ""))
						misses.push(`${rel}: ${call}`);
		}
		expect(misses).toEqual([]);
	});

	test("every SDK reference example passes apiKey to the client", () => {
		const misses: string[] = [];
		for (const file of files(EXAMPLES, ".ts"))
			for (const call of keyless(readFileSync(file, "utf8")))
				misses.push(`${relative(EXAMPLES, file)}: ${call}`);
		for (const file of files(REFERENCE, ".json"))
			for (const m of readFileSync(file, "utf8").matchAll(
				/"code":\s*("(?:[^"\\]|\\.)*")/g,
			))
				for (const call of keyless(JSON.parse(m[1] ?? '""') as string))
					misses.push(`${relative(REFERENCE, file)}: ${call}`);
		expect(misses).toEqual([]);
	});
});
