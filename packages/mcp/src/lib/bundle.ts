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
  const result = await esbuild.build({
    stdin: { contents: code, loader: "ts", resolveDir: process.cwd() },
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["@secondlayer/subgraphs"],
    write: false,
  });
  const handlerCode = new TextDecoder().decode(result.outputFiles![0]!.contents);

  const dataUri = `data:text/javascript;base64,${Buffer.from(handlerCode).toString("base64")}`;
  const mod = await import(dataUri);
  const def = mod.default ?? mod;

  const validated = validateSubgraphDefinition(def);

  return {
    name: validated.name,
    version: validated.version,
    description: validated.description,
    sources: validated.sources.map(sourceKey),
    schema: validated.schema,
    handlerCode,
  };
}
