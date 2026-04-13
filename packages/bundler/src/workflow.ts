import type {
	RetryConfig,
	WorkflowTrigger,
} from "@secondlayer/workflows/types";
import { validateWorkflowDefinition } from "@secondlayer/workflows/validate";
import esbuild from "esbuild";
import { BundleSizeError, WORKFLOW_BUNDLE_MAX_BYTES } from "./errors.ts";
import { stubPackagesPlugin } from "./stub-plugin.ts";

export interface WorkflowBundleResult {
	name: string;
	trigger: WorkflowTrigger;
	handlerCode: string;
	sourceCode: string;
	retries?: RetryConfig;
	timeout?: number;
}

export async function bundleWorkflowCode(
	code: string,
): Promise<WorkflowBundleResult> {
	let result: esbuild.BuildResult;
	try {
		result = await esbuild.build({
			stdin: { contents: code, loader: "ts", resolveDir: process.cwd() },
			bundle: true,
			platform: "node",
			format: "esm",
			// Intercept `@secondlayer/workflows` with an inline stub so esbuild
			// doesn't walk the filesystem looking for node_modules (which fails
			// on Vercel serverless where the repo's node_modules isn't next to
			// process.cwd()). The stub provides a literal `defineWorkflow`
			// identity function — the only runtime export user workflows import.
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
	if (outputFile.contents.byteLength > WORKFLOW_BUNDLE_MAX_BYTES) {
		throw new BundleSizeError(
			"workflow",
			outputFile.contents.byteLength,
			WORKFLOW_BUNDLE_MAX_BYTES,
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

	let validated: ReturnType<typeof validateWorkflowDefinition>;
	try {
		validated = validateWorkflowDefinition(def);
	} catch (err: unknown) {
		throw new Error(
			`Validation failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	return {
		name: validated.name,
		trigger: validated.trigger,
		handlerCode,
		sourceCode: code,
		retries: validated.retries,
		timeout: validated.timeout,
	};
}
