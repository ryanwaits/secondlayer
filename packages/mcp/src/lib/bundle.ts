import esbuild from "esbuild";
import { validateSubgraphDefinition } from "@secondlayer/subgraphs/validate";
import { sourceKey } from "@secondlayer/subgraphs";

interface BundleResult {
  name: string;
  version?: string;
  description?: string;
  sources: string[];
  schema: Record<string, unknown>;
  handlerCode: string;
}

export async function bundleSubgraphCode(code: string): Promise<BundleResult> {
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
    throw new Error(`Bundle failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const handlerCode = new TextDecoder().decode(result.outputFiles![0]!.contents);

  let mod: Record<string, unknown>;
  try {
    const dataUri = `data:text/javascript;base64,${Buffer.from(handlerCode).toString("base64")}`;
    mod = await import(dataUri);
  } catch (err: unknown) {
    throw new Error(`Module evaluation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const def = mod.default ?? mod;

  let validated: ReturnType<typeof validateSubgraphDefinition>;
  try {
    validated = validateSubgraphDefinition(def);
  } catch (err: unknown) {
    throw new Error(`Validation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    name: validated.name,
    version: validated.version,
    description: validated.description,
    sources: validated.sources.map(sourceKey),
    schema: validated.schema,
    handlerCode,
  };
}
