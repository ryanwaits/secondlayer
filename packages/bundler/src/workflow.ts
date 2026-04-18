import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
	RetryConfig,
	WorkflowTrigger,
} from "@secondlayer/workflows/types";
import { validateWorkflowDefinition } from "@secondlayer/workflows/validate";
import esbuild from "esbuild";
import { BundleSizeError, WORKFLOW_BUNDLE_MAX_BYTES } from "./errors.ts";
import { lintUnsafeBroadcast } from "./lint-broadcast.ts";
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
	const unsafe = lintUnsafeBroadcast(code);
	if (unsafe.length > 0) {
		const msg = unsafe
			.map(
				(u) =>
					`  line ${u.line}: broadcast() inside tool "${u.toolName}" has no cost cap or postConditions. Add { maxMicroStx, maxFee } or postConditions, or opt out with \`// @sl-unsafe-broadcast\`.`,
			)
			.join("\n");
		throw new Error(
			`Unsafe broadcast detected — AI-controlled args can drain funds without caps.\n${msg}`,
		);
	}

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

	// Write to a temp file and import from its file URL. Avoids the base64
	// data-URI `NameTooLong` limit that strict runtimes hit once dependencies
	// (AI SDK, providers, etc.) push the bundle past ~1 MB. `/tmp` is writable
	// on every runtime we care about (Vercel serverless, Bun, Node).
	const dir = await mkdtemp(join(tmpdir(), "sl-bundle-"));
	const file = join(dir, "handler.mjs");
	let mod: Record<string, unknown>;
	try {
		await writeFile(file, handlerCode);
		mod = await import(pathToFileURL(file).href);
	} catch (err: unknown) {
		throw new Error(
			`Module evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
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
