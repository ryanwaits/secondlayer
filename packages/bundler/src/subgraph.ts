import { validateSubgraphDefinition } from "@secondlayer/subgraphs/validate";
import type { HandlerFinding } from "@secondlayer/subgraphs/verification";
import esbuild from "esbuild";
import { type ScanSourceMap, scanHandlerDeterminism } from "./determinism.ts";
import { BundleSizeError, SUBGRAPH_BUNDLE_MAX_BYTES } from "./errors.ts";
import { extractSubgraphDefinition } from "./extract.ts";
import { stubPackagesPlugin } from "./stub-plugin.ts";

const INDEX_SHAPE_HINT =
	'Subgraph schema hint: use indexes: [["sender"], ["recipient"]], not indexes: [{ columns: ["sender"] }].';

export interface SubgraphBundleResult {
	name: string;
	description?: string;
	sources: Record<string, Record<string, unknown>>;
	schema: Record<string, unknown>;
	handlerCode: string;
	/** Determinism scan of `handlerCode`, positions mapped to the author's
	 *  files. Feed to `deriveVerification`. */
	findings: HandlerFinding[];
}

export interface BundleSubgraphOptions {
	/** Name reported for the entry source in findings. Default `subgraph.ts`. */
	fileName?: string;
}

export async function bundleSubgraphCode(
	code: string,
	opts: BundleSubgraphOptions = {},
): Promise<SubgraphBundleResult> {
	let result: esbuild.BuildResult;
	try {
		result = await esbuild.build({
			stdin: { contents: code, loader: "ts", resolveDir: process.cwd() },
			bundle: true,
			platform: "node",
			format: "esm",
			// Intercept `@secondlayer/subgraphs` with an inline stub so esbuild
			// doesn't walk the filesystem looking for node_modules. See
			// stub-plugin.ts for the full rationale.
			plugins: [stubPackagesPlugin()],
			write: false,
			// External map (no sourceMappingURL comment), so handlerCode stays
			// byte-identical; it only maps scan findings back to source lines.
			sourcemap: "external",
			outfile: "handler.js",
		});
	} catch (err: unknown) {
		throw new Error(
			`Bundle failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	const outputFile = result.outputFiles?.find((f) => f.path.endsWith(".js"));
	const mapFile = result.outputFiles?.find((f) => f.path.endsWith(".map"));
	if (!outputFile) {
		throw new Error("Bundle failed: no output produced");
	}
	if (outputFile.contents.byteLength > SUBGRAPH_BUNDLE_MAX_BYTES) {
		throw new BundleSizeError(
			outputFile.contents.byteLength,
			SUBGRAPH_BUNDLE_MAX_BYTES,
		);
	}
	const handlerCode = new TextDecoder().decode(outputFile.contents);
	const findings = scanHandlerDeterminism(handlerCode, {
		sourceMap: mapFile ? readSourceMap(mapFile.text, opts.fileName) : undefined,
	});

	let def: Record<string, unknown>;
	try {
		const extracted = extractSubgraphDefinition(code);
		def = { ...extracted, handlers: extracted.handlerSources };
	} catch (err: unknown) {
		throw new Error(
			`Module evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	let validated: ReturnType<typeof validateSubgraphDefinition>;
	try {
		validated = validateSubgraphDefinition(def);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		const hint = shouldShowIndexShapeHint(message)
			? `\n\n${INDEX_SHAPE_HINT}`
			: "";
		throw new Error(`Validation failed: ${message}${hint}`);
	}

	return {
		name: validated.name,
		description: validated.description,
		sources: validated.sources as unknown as Record<
			string,
			Record<string, unknown>
		>,
		schema: validated.schema,
		handlerCode,
		findings,
	};
}

/** Parse esbuild's map, naming the stdin entry after the author's file. */
function readSourceMap(text: string, fileName = "subgraph.ts"): ScanSourceMap {
	const map = JSON.parse(text) as ScanSourceMap;
	return {
		mappings: map.mappings,
		sources: map.sources.map((s) => (s === "<stdin>" ? fileName : s)),
	};
}

function shouldShowIndexShapeHint(message: string): boolean {
	return (
		message.includes('"indexes"') &&
		message.includes('"expected": "array"') &&
		message.includes('"invalid_type"')
	);
}
