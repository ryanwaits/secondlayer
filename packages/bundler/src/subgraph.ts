import { validateSubgraphDefinition } from "@secondlayer/subgraphs/validate";
import esbuild from "esbuild";
import { BundleSizeError, SUBGRAPH_BUNDLE_MAX_BYTES } from "./errors.ts";

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
			external: ["@secondlayer/subgraphs"],
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
			"subgraph",
			outputFile.contents.byteLength,
			SUBGRAPH_BUNDLE_MAX_BYTES,
		);
	}
	const handlerCode = new TextDecoder().decode(outputFile.contents);

	let mod: Record<string, unknown>;
	try {
		const dataUri = `data:text/javascript;base64,${Buffer.from(handlerCode).toString("base64")}`;
		mod = await import(dataUri);
	} catch (err: unknown) {
		throw new Error(
			`Module evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	const def = mod.default ?? mod;

	let validated: ReturnType<typeof validateSubgraphDefinition>;
	try {
		validated = validateSubgraphDefinition(def);
	} catch (err: unknown) {
		throw new Error(
			`Validation failed: ${err instanceof Error ? err.message : String(err)}`,
		);
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
