import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateSubgraphDefinition } from "@secondlayer/subgraphs/validate";
import esbuild from "esbuild";
import { BundleSizeError, SUBGRAPH_BUNDLE_MAX_BYTES } from "./errors.ts";
import { stubPackagesPlugin } from "./stub-plugin.ts";

const INDEX_SHAPE_HINT =
	'Subgraph schema hint: use indexes: [["sender"], ["recipient"]], not indexes: [{ columns: ["sender"] }].';

export interface SubgraphBundleResult {
	name: string;
	version?: string;
	description?: string;
	sources: Record<string, Record<string, unknown>>;
	schema: Record<string, unknown>;
	handlerCode: string;
}

export async function bundleSubgraphCode(
	code: string,
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
		});
	} catch (err: unknown) {
		throw new Error(
			`Bundle failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	const outputFile = result.outputFiles?.[0];
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

	let mod: Record<string, unknown>;
	let tempDir: string | undefined;
	try {
		tempDir = await mkdtemp(join(tmpdir(), "secondlayer-subgraph-"));
		const tempFile = join(tempDir, "handler.mjs");
		await writeFile(tempFile, handlerCode);
		mod = await import(`${pathToFileURL(tempFile).href}?t=${Date.now()}`);
	} catch (err: unknown) {
		throw new Error(
			`Module evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	} finally {
		if (tempDir) await rm(tempDir, { recursive: true, force: true });
	}
	const def = mod.default ?? mod;

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
		version: validated.version,
		description: validated.description,
		sources: validated.sources as unknown as Record<
			string,
			Record<string, unknown>
		>,
		schema: validated.schema,
		handlerCode,
	};
}

function shouldShowIndexShapeHint(message: string): boolean {
	return (
		message.includes('"indexes"') &&
		message.includes('"expected": "array"') &&
		message.includes('"invalid_type"')
	);
}
