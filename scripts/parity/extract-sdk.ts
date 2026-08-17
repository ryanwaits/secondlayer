/**
 * Parity-audit extractor for the @secondlayer/sdk programmatic surface.
 *
 * Instantiates `new SecondLayer()` with a dummy config (the constructor makes
 * no network calls) and reflectively walks every client namespace, resource
 * object, callable resource (`Object.assign(fn, { list, walk })`), and
 * prototype method chain. TypeScript `private`/`protected` members are
 * invisible at runtime, so their names are collected statically from the
 * client sources and excluded. Also enumerates package.json subpath exports,
 * the exported error classes, and standalone helpers.
 *
 * Run from repo root: `bun scripts/parity/extract-sdk.ts`
 * Output: scripts/parity/out/sdk.json
 */

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sdkPackageJson from "../../packages/sdk/package.json";
import { SecondLayer } from "../../packages/sdk/src/client.ts";
import * as sdkErrors from "../../packages/sdk/src/errors.ts";
import { consumeIndexFeed } from "../../packages/sdk/src/index-api/index.ts";
import { getSubgraph } from "../../packages/sdk/src/subgraphs/index.ts";
import { trigger } from "../../packages/sdk/src/subscriptions/client.ts";

interface SurfaceItem {
	id: string;
	group: string;
	kind: "method" | "export" | "error";
}

const GENERATED_FROM = [
	"packages/sdk/src/client.ts",
	"packages/sdk/src/base.ts",
	"packages/sdk/src/errors.ts",
	"packages/sdk/src/index-api/client.ts",
	"packages/sdk/src/streams/client.ts",
	"packages/sdk/src/contracts/client.ts",
	"packages/sdk/src/subgraphs/client.ts",
	"packages/sdk/src/subscriptions/client.ts",
	"packages/sdk/package.json",
];

/** Class-member sources scanned for TS `private`/`protected` declarations. */
const CLASS_SOURCES = [
	"client.ts",
	"base.ts",
	"index-api/client.ts",
	"contracts/client.ts",
	"subgraphs/client.ts",
	"subscriptions/client.ts",
];

/** Prototypes that are plumbing, not capability surface. */
const SKIPPED_PROTO_CLASSES = new Set(["BaseClient", "Object", "Function"]);

function isPublicName(name: string): boolean {
	return !name.startsWith("_") && !name.startsWith("#");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		!(value instanceof Date)
	);
}

/**
 * TS `private`/`protected` members still exist on runtime objects; collect
 * their names from source so the reflective walk can skip them.
 */
async function collectNonPublicNames(sdkSrcDir: string): Promise<Set<string>> {
	const names = new Set<string>();
	const memberPattern =
		/^\s*(?:private|protected)\s+(?:readonly\s+)?(?:async\s+)?\*?\s*([A-Za-z_$][\w$]*)/gm;
	for (const relPath of CLASS_SOURCES) {
		const source = await Bun.file(join(sdkSrcDir, relPath)).text();
		for (const match of source.matchAll(memberPattern)) {
			names.add(match[1]);
		}
	}
	return names;
}

/** Does this function carry attached resource props (callable resource)? */
function hasAttachedProps(fn: object): boolean {
	return Object.entries(fn).some(
		([key, value]) =>
			isPublicName(key) &&
			(typeof value === "function" || isPlainObject(value)),
	);
}

/**
 * Walk a namespace object: own enumerable methods, nested resource objects,
 * callable resources, and prototype methods (stopping at BaseClient).
 */
function walk(
	obj: object,
	prefix: string,
	group: string,
	push: (item: SurfaceItem) => void,
	seen: Set<object>,
	nonPublic: Set<string>,
): void {
	if (seen.has(obj)) return;
	seen.add(obj);

	const ownEntries = Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));
	for (const [key, value] of ownEntries) {
		if (!isPublicName(key) || nonPublic.has(key)) continue;
		const id = `${prefix}.${key}`;
		if (typeof value === "function") {
			push({ id, group, kind: "method" });
			if (hasAttachedProps(value)) {
				walk(value, id, group, push, seen, nonPublic);
			}
		} else if (isPlainObject(value)) {
			walk(value, id, group, push, seen, nonPublic);
		}
	}

	let proto = Object.getPrototypeOf(obj);
	while (proto && !SKIPPED_PROTO_CLASSES.has(proto.constructor?.name ?? "")) {
		for (const key of Object.getOwnPropertyNames(proto).sort()) {
			if (key === "constructor" || !isPublicName(key)) continue;
			if (nonPublic.has(key)) continue;
			const descriptor = Object.getOwnPropertyDescriptor(proto, key);
			if (typeof descriptor?.value === "function") {
				push({ id: `${prefix}.${key}`, group, kind: "method" });
			}
		}
		proto = Object.getPrototypeOf(proto);
	}
}

function extract(nonPublic: Set<string>): SurfaceItem[] {
	const items: SurfaceItem[] = [];
	const seenIds = new Set<string>();
	const push = (item: SurfaceItem): void => {
		if (seenIds.has(item.id)) return;
		seenIds.add(item.id);
		items.push(item);
	};
	const seen = new Set<object>();

	// Dummy config; constructor stores options and builds lazy closures only.
	const client = new SecondLayer({
		apiKey: "sl-parity-audit-dummy-key",
		baseUrl: "http://127.0.0.1:1",
		dumpsBaseUrl: "http://127.0.0.1:1",
	});

	// Top-level client methods (batch, context) — walk() prefixes ids, so
	// enumerate the SecondLayer prototype directly.
	const clientProto = Object.getPrototypeOf(client);
	for (const key of Object.getOwnPropertyNames(clientProto).sort()) {
		if (key === "constructor" || !isPublicName(key) || nonPublic.has(key)) {
			continue;
		}
		const descriptor = Object.getOwnPropertyDescriptor(clientProto, key);
		if (typeof descriptor?.value === "function") {
			push({ id: key, group: "client", kind: "method" });
		}
	}

	// Namespaces: streams, index, contracts, subgraphs, subscriptions.
	const namespaces = [
		"streams",
		"index",
		"contracts",
		"subgraphs",
		"subscriptions",
	] as const;
	for (const namespace of namespaces) {
		walk(client[namespace], namespace, namespace, push, seen, nonPublic);
	}

	// subgraphs.typed() table clients: methods only exist on the object the
	// call returns, so materialize one locally (no network) and enumerate it.
	const typedTable = client.subgraphs.typed({
		name: "parity-probe",
		schema: { probe: {} },
	}) as Record<string, object>;
	walk(typedTable.probe, "subgraphs.typed", "subgraphs", push, seen, nonPublic);

	// Standalone helper exports.
	push({ id: "consumeIndexFeed", group: "index", kind: "export" });
	push({ id: "getSubgraph", group: "subgraphs", kind: "export" });
	push({ id: "trigger", group: "subscriptions", kind: "export" });
	for (const [key, value] of Object.entries(trigger).sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		if (typeof value === "function" && isPublicName(key)) {
			push({ id: `trigger.${key}`, group: "subscriptions", kind: "export" });
		}
	}

	// package.json subpath exports; the sinks family is its own group.
	for (const subpath of Object.keys(sdkPackageJson.exports)) {
		const id = subpath === "." ? "." : subpath.replace(/^\.\//, "");
		const group = id.startsWith("sinks/") ? "sinks" : "exports";
		push({ id, group, kind: "export" });
	}

	// Exported error classes.
	for (const [name, value] of Object.entries(sdkErrors).sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		if (
			typeof value === "function" &&
			value.prototype instanceof Error &&
			isPublicName(name)
		) {
			push({ id: name, group: "errors", kind: "error" });
		}
	}

	// Guard against unused-import elision hiding surface drift.
	if (typeof consumeIndexFeed !== "function") {
		throw new Error("consumeIndexFeed is no longer a function export");
	}
	if (typeof getSubgraph !== "function") {
		throw new Error("getSubgraph is no longer a function export");
	}

	return items;
}

async function main(): Promise<void> {
	const scriptDir = dirname(fileURLToPath(import.meta.url));
	const sdkSrcDir = join(scriptDir, "..", "..", "packages", "sdk", "src");
	const outDir = join(scriptDir, "out");
	await mkdir(outDir, { recursive: true });

	const nonPublic = await collectNonPublicNames(sdkSrcDir);
	const items = extract(nonPublic);
	const output = {
		surface: "sdk",
		generatedFrom: GENERATED_FROM,
		items,
	};
	const outPath = join(outDir, "sdk.json");
	await Bun.write(outPath, `${JSON.stringify(output, null, "\t")}\n`);

	const byGroup = new Map<string, number>();
	for (const item of items) {
		byGroup.set(item.group, (byGroup.get(item.group) ?? 0) + 1);
	}
	console.log(`wrote ${items.length} items to ${outPath}`);
	for (const [group, count] of [...byGroup].sort()) {
		console.log(`  ${group}: ${count}`);
	}
}

await main();
