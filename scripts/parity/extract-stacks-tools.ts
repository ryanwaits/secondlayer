/**
 * Parity-audit extractor for the @secondlayer/stacks AI-SDK toolkit.
 *
 * Imports the two published tool subpaths (`./tools`, `./tools/btc`) from
 * source and detects every exported AI SDK tool structurally (description +
 * inputSchema + execute). `createStacksTools` is invoked with an inert stub
 * client purely to enumerate the factory's tool keys — tool `execute`
 * functions never run, so no network call is made.
 *
 * Run from repo root: `bun scripts/parity/extract-stacks-tools.ts`
 * Output: `scripts/parity/out/stacks-tools.json`
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as btcTools from "../../packages/stacks/src/tools/btc/index.ts";
import type { StacksReadClient } from "../../packages/stacks/src/tools/client.ts";
import * as stacksTools from "../../packages/stacks/src/tools/index.ts";

interface ParityItem {
	id: string;
	group: string;
	description: string;
}

interface ParitySurface {
	surface: "stacks-tools";
	generatedFrom: string[];
	items: ParityItem[];
	resources: [];
}

interface AiToolLike {
	description: string;
	inputSchema: unknown;
	execute: (...args: unknown[]) => unknown;
}

function isAiTool(value: unknown): value is AiToolLike {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as AiToolLike).description === "string" &&
		"inputSchema" in value &&
		typeof (value as AiToolLike).execute === "function"
	);
}

function collectTools(
	moduleExports: Record<string, unknown>,
	group: string,
): ParityItem[] {
	return Object.entries(moduleExports)
		.filter(([, value]) => isAiTool(value))
		.map(([name, value]) => ({
			id: name,
			group,
			description: (value as AiToolLike).description,
		}));
}

const items: ParityItem[] = [
	...collectTools(stacksTools, "stacks"),
	...collectTools(btcTools, "btc"),
];

// Enumerate the factory's bound-tool keys with a stub client (never executed)
// and cross-check them against the bare exports so the two modes can't drift.
const factoryTools = stacksTools.createStacksTools(
	{} as unknown as StacksReadClient,
);
const factoryKeys = Object.keys(factoryTools).sort();
const bareStacksIds = items
	.filter((item) => item.group === "stacks")
	.map((item) => item.id)
	.sort();
if (JSON.stringify(factoryKeys) !== JSON.stringify(bareStacksIds)) {
	throw new Error(
		`createStacksTools keys drifted from bare exports.\n  factory: ${factoryKeys.join(", ")}\n  bare:    ${bareStacksIds.join(", ")}`,
	);
}
items.push({
	id: "createStacksTools",
	group: "stacks",
	description: `Factory binding the ${factoryKeys.length} Stacks read tools (${factoryKeys.join(", ")}) to an explicit StacksReadClient.`,
});

const duplicates = items
	.map((item) => item.id)
	.filter((id, i, ids) => ids.indexOf(id) !== i);
if (duplicates.length > 0) {
	throw new Error(`duplicate tool ids: ${duplicates.join(", ")}`);
}

const surface: ParitySurface = {
	surface: "stacks-tools",
	generatedFrom: [
		"packages/stacks/src/tools/index.ts",
		"packages/stacks/src/tools/btc/index.ts",
	],
	items,
	resources: [],
};

const outDir = join(dirname(fileURLToPath(import.meta.url)), "out");
await mkdir(outDir, { recursive: true });
const gitignore = Bun.file(join(outDir, ".gitignore"));
if (!(await gitignore.exists())) {
	await Bun.write(gitignore, "*.json\n");
}
await Bun.write(
	join(outDir, "stacks-tools.json"),
	`${JSON.stringify(surface, null, "\t")}\n`,
);

const groups = new Set(items.map((item) => item.group));
console.log(
	`stacks-tools surface: ${items.length} tools across ${groups.size} groups → scripts/parity/out/stacks-tools.json`,
);
