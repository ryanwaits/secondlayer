import type {
	RetryConfig,
	WorkflowTrigger,
} from "@secondlayer/workflows/types";
import { validateWorkflowDefinition } from "@secondlayer/workflows/validate";
import esbuild from "esbuild";
import { BundleSizeError, WORKFLOW_BUNDLE_MAX_BYTES } from "./errors.ts";

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
			// DON'T externalize @secondlayer/workflows — the bundled handler is
			// validated by `import(dataUri)` below, and data-URI imports can't
			// resolve bare specifiers (no parent URL). `defineWorkflow` is a
			// pure identity function so inlining it adds negligible bytes.
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
