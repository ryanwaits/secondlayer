import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";

/**
 * `ai` and `zod` are optional peers that only the deprecated `/tools`
 * entries import. Walk the static import graph from the root entry and
 * assert neither ever appears, so a project that installs the package to
 * read contracts never needs them installed.
 */
const transpiler = new Bun.Transpiler({ loader: "ts" });

async function importGraph(entry: string): Promise<Set<string>> {
	const seen = new Set<string>();
	const bare = new Set<string>();
	const queue = [entry];
	while (queue.length) {
		const file = queue.pop() as string;
		if (seen.has(file)) continue;
		seen.add(file);
		const source = await Bun.file(file).text();
		for (const { path } of transpiler.scanImports(source)) {
			if (path.startsWith(".")) {
				queue.push(resolve(dirname(file), path));
			} else if (!path.startsWith("node:")) {
				bare.add(path);
			}
		}
	}
	return bare;
}

describe("root entry import graph", () => {
	test("importing @secondlayer/stacks never loads ai or zod", async () => {
		const bare = await importGraph(resolve(import.meta.dir, "../index.ts"));
		const offenders = [...bare].filter(
			(p) =>
				p === "ai" ||
				p === "zod" ||
				p.startsWith("ai/") ||
				p.startsWith("zod/"),
		);
		expect(offenders).toEqual([]);
	});

	test("the tools entry is the one that pulls the optional peers", async () => {
		const bare = await importGraph(
			resolve(import.meta.dir, "../tools/index.ts"),
		);
		expect(bare.has("ai")).toBe(true);
		expect(bare.has("zod")).toBe(true);
	});

	test("root never loads clarinet-sdk; /simnet only pulls @stacks/transactions", async () => {
		const root = await importGraph(resolve(import.meta.dir, "../index.ts"));
		expect(root.has("@stacks/clarinet-sdk")).toBe(false);
		expect(root.has("@stacks/transactions")).toBe(false);
		const simnet = await importGraph(
			resolve(import.meta.dir, "../simnet/index.ts"),
		);
		// Simnet is a type-only import from clarinet-sdk; the caller constructs
		// the session. Runtime conversion uses @stacks/transactions CVs.
		expect(simnet.has("@stacks/clarinet-sdk")).toBe(false);
		expect(simnet.has("@stacks/transactions")).toBe(true);
	});
});
