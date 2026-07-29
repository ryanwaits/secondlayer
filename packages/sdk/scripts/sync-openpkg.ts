import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
/**
 * Generates the SDK reference for the docs site from this package's own
 * TypeScript source, via openpkg.
 *
 * Run from packages/sdk:  bun run openpkg
 *
 * openpkg emits a full spec with every type expanded — ~2 MB, far too much to
 * ship into a page bundle. This distills it to what a reference index needs:
 * name, kind, one-line summary, a rendered signature, and where it lives.
 * Full types are the .d.ts's job, and your editor already has them.
 */
import { $ } from "bun";

const OUT = join(
	import.meta.dir,
	"../../../apps/web/src/generated/sdk-spec.json",
);
const TMP = join(import.meta.dir, "../.openpkg-spec.json");

type Schema = {
	$ref?: string;
	type?: string;
	items?: Schema;
	anyOf?: Schema[];
	oneOf?: Schema[];
};

type SpecExport = {
	name: string;
	kind: string;
	description?: string;
	source?: { file: string; line: number };
	signatures?: Array<{
		parameters?: Array<{ name: string; schema?: Schema; required?: boolean }>;
		returns?: { schema?: Schema };
	}>;
};

/** `#/types/StreamsClient` → `StreamsClient`; arrays and unions kept legible. */
function typeName(schema: Schema | undefined): string {
	if (!schema) return "unknown";
	if (schema.$ref) return schema.$ref.split("/").pop() ?? "unknown";
	if (schema.type === "array") return `${typeName(schema.items)}[]`;
	const union = schema.anyOf ?? schema.oneOf;
	if (union) return union.map(typeName).join(" | ");
	return schema.type ?? "object";
}

/** `verifyTransactionProof(proof, opts?): TransactionProofVerifyResult` */
function signature(entry: SpecExport): string | null {
	const sig = entry.signatures?.[0];
	if (!sig) return null;
	const params = (sig.parameters ?? [])
		.map(
			(p) =>
				`${p.name}${p.required === false ? "?" : ""}: ${typeName(p.schema)}`,
		)
		.join(", ");
	return `${entry.name}(${params}): ${typeName(sig.returns?.schema)}`;
}

/** First sentence of the doc comment — the index needs a label, not an essay. */
function summarize(description: string | undefined): string {
	if (!description) return "";
	const firstPara = description.split("\n\n")[0]?.replace(/\s+/g, " ").trim();
	if (!firstPara) return "";
	const sentence = firstPara.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? firstPara;
	return sentence.length > 200 ? `${sentence.slice(0, 197)}…` : sentence;
}

/** Source file → the product area a reader is actually looking under. */
const AREAS: Array<[RegExp, string]> = [
	[/^src\/(client|base)\.ts/, "Client"],
	[/^src\/index-api\//, "Index"],
	[/^src\/streams\//, "Streams"],
	[/^src\/subgraphs\/|^src\/get-subgraph/, "Subgraphs"],
	[/^src\/subscriptions\/|^src\/webhooks\.ts/, "Subscriptions and webhooks"],
	[/^src\/proofs\.ts/, "Proofs"],
	[/^src\/x402\.ts/, "x402"],
	[/^src\/contracts\//, "Contracts"],
	[/^src\/(api-keys|projects)\//, "Account"],
	[/^src\/clarity\.ts/, "Clarity"],
	[/errors/, "Errors"],
];

function areaOf(file: string | undefined): string {
	if (!file) return "Other";
	// Re-exports from @secondlayer/shared resolve to absolute dist paths; they
	// are part of the public surface, so group them by what they cover rather
	// than dropping them into Other.
	const normalized = file.replace(
		/^.*\/packages\/shared\/(dist\/)?/,
		"shared/",
	);
	for (const [pattern, area] of AREAS) {
		if (pattern.test(normalized)) return area;
	}
	if (normalized.startsWith("shared/")) {
		if (/subscriptions|webhook/.test(normalized))
			return "Subscriptions and webhooks";
		if (/subgraph/.test(normalized)) return "Subgraphs";
		if (/node|consensus/.test(normalized)) return "Proofs";
		if (/event-types|streams/.test(normalized)) return "Streams";
	}
	return "Other";
}

await $`bunx openpkg spec src/index.ts -o ${TMP}`.cwd(
	join(import.meta.dir, ".."),
);

const spec = (await Bun.file(TMP).json()) as { exports: SpecExport[] };
// openpkg's meta.name is derived from the entry file, so take the real
// identity from package.json.
const pkg = (await Bun.file(
	join(import.meta.dir, "../package.json"),
).json()) as {
	name: string;
	version: string;
};

const byArea = new Map<string, Array<Record<string, unknown>>>();
for (const entry of spec.exports) {
	const area = areaOf(entry.source?.file);
	const list = byArea.get(area) ?? [];
	list.push({
		name: entry.name,
		kind: entry.kind,
		summary: summarize(entry.description),
		signature: signature(entry),
		file: entry.source?.file.replace(/^.*\/packages\//, "packages/") ?? null,
		line: entry.source?.line ?? null,
	});
	byArea.set(area, list);
}

// Stable order: the areas readers reach for first, then the rest alphabetically.
const LEAD = [
	"Client",
	"Index",
	"Subgraphs",
	"Streams",
	"Subscriptions and webhooks",
];
const areas = [...byArea.keys()].sort((a, b) => {
	const ai = LEAD.indexOf(a);
	const bi = LEAD.indexOf(b);
	if (ai !== -1 || bi !== -1)
		return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
	if (a === "Other") return 1;
	if (b === "Other") return -1;
	return a.localeCompare(b);
});

const out = {
	package: pkg.name,
	version: pkg.version,
	areas: areas.map((name) => ({
		name,
		exports: (byArea.get(name) ?? []).sort((a, b) =>
			String(a.name).localeCompare(String(b.name)),
		),
	})),
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(out, null, "\t")}\n`);
await $`rm -f ${TMP}`;

console.log(
	`✓ apps/web/src/generated/sdk-spec.json — ${spec.exports.length} exports across ${areas.length} areas`,
);
