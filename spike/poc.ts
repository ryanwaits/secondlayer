// f049 SPIKE PoC — run with:  bun run spike/poc.ts
//
// Demonstrates, at the lowest-risk site (bundle-time definition extraction,
// packages/bundler/src/subgraph.ts), two ways to turn hostile subgraph source
// into a validated definition:
//
//   A. EXECUTE  — what the code does TODAY: esbuild-bundle then `import()` the
//      module, which runs its top-level side effects in THIS process. The
//      malicious fixture reads process.env.SECONDLAYER_SECRETS_KEY and exfils it.
//
//   B. AST-EXTRACT — parse the TypeScript with the compiler API and statically
//      read the `defineSubgraph({...})` literal (name / sources / schema)
//      WITHOUT executing a single line of user code. The secret read never fires.
//
// The canary file is our exfil detector: if path A/B caused the module's
// top-level code to run, the canary contains the "stolen" key.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import esbuild, { type Plugin } from "esbuild";
import ts from "typescript";

const SOURCE_PATH = join(import.meta.dir, "malicious-subgraph.ts");
const SOURCE = readFileSync(SOURCE_PATH, "utf8");

// A fake master key so we can prove it leaks without touching a real one.
process.env.SECONDLAYER_SECRETS_KEY =
	"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

const scratch = mkdtempSync(join(tmpdir(), "f049-spike-"));
const canaryPath = join(scratch, "canary.log");
writeFileSync(canaryPath, "");
process.env.SL_SPIKE_CANARY = canaryPath;

function canaryFired(): boolean {
	return readFileSync(canaryPath, "utf8").includes("EXFIL");
}
function resetCanary(): void {
	writeFileSync(canaryPath, "");
}

// Mirror of packages/bundler/src/stub-plugin.ts so the bundle resolves without
// node_modules — identical to production.
function stubPackagesPlugin(): Plugin {
	return {
		name: "secondlayer-stub-packages",
		setup(build) {
			const filter = /^@secondlayer\/subgraphs$/;
			build.onResolve({ filter }, (args) => ({
				path: args.path,
				namespace: "secondlayer-stub",
			}));
			build.onLoad({ filter: /.*/, namespace: "secondlayer-stub" }, () => ({
				contents: "export function defineSubgraph(def) { return def; }\n",
				loader: "js",
			}));
		},
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// PATH A — current behaviour: bundle + import() (executes user code)
// ─────────────────────────────────────────────────────────────────────────────
async function runExecutePath(): Promise<{ name: string; ms: number }> {
	const t0 = performance.now();
	const result = await esbuild.build({
		stdin: { contents: SOURCE, loader: "ts", resolveDir: process.cwd() },
		bundle: true,
		platform: "node",
		format: "esm",
		plugins: [stubPackagesPlugin()],
		write: false,
	});
	const outputFile = result.outputFiles?.[0];
	if (!outputFile) throw new Error("esbuild produced no output");
	const handlerCode = new TextDecoder().decode(outputFile.contents);
	const dir = mkdtempSync(join(tmpdir(), "f049-exec-"));
	const file = join(dir, "handler.mjs");
	writeFileSync(file, handlerCode);
	const mod = await import(pathToFileURL(file).href);
	const def = (mod.default ?? mod) as { name: string };
	rmSync(dir, { recursive: true, force: true });
	const ms = performance.now() - t0;
	return { name: def.name, ms };
}

// ─────────────────────────────────────────────────────────────────────────────
// PATH B — AST-only: parse, never execute
// ─────────────────────────────────────────────────────────────────────────────
// Statically evaluate a limited subset of literal expressions: string / number /
// boolean, array literals, and object literals. Anything non-literal (a call, an
// identifier, a template with substitutions) throws — the point is that we only
// accept a declarative definition and refuse to run code to learn its shape.
function evalLiteral(node: ts.Expression): unknown {
	if (ts.isStringLiteralLike(node)) return node.text;
	if (ts.isNumericLiteral(node)) return Number(node.text);
	if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
	if (node.kind === ts.SyntaxKind.NullKeyword) return null;
	if (ts.isArrayLiteralExpression(node)) {
		return node.elements.map((e) => evalLiteral(e));
	}
	if (ts.isObjectLiteralExpression(node)) {
		const out: Record<string, unknown> = {};
		for (const prop of node.properties) {
			if (!ts.isPropertyAssignment(prop)) {
				throw new Error(`non-literal property (${ts.SyntaxKind[prop.kind]})`);
			}
			const key = prop.name.getText(node.getSourceFile());
			const cleanKey =
				ts.isStringLiteralLike(prop.name) || ts.isNumericLiteral(prop.name)
					? prop.name.text
					: key;
			out[cleanKey] = evalLiteral(prop.initializer);
		}
		return out;
	}
	// Function properties (handlers) are intentionally NOT evaluated here — the
	// AST-only extractor is for the deploy/bundle metadata sites. Handlers stay
	// as opaque source and are compiled/sandboxed only for the per-block path.
	throw new Error(`non-literal expression: ${ts.SyntaxKind[node.kind]}`);
}

function findDefineSubgraphArg(
	sf: ts.SourceFile,
): ts.ObjectLiteralExpression | null {
	let found: ts.ObjectLiteralExpression | null = null;
	const visit = (n: ts.Node): void => {
		const firstArg = ts.isCallExpression(n) ? n.arguments[0] : undefined;
		if (
			ts.isCallExpression(n) &&
			ts.isIdentifier(n.expression) &&
			n.expression.text === "defineSubgraph" &&
			n.arguments.length === 1 &&
			firstArg &&
			ts.isObjectLiteralExpression(firstArg)
		) {
			found = firstArg;
			return;
		}
		ts.forEachChild(n, visit);
	};
	visit(sf);
	return found;
}

function runAstPath(): {
	name: string;
	sources: unknown;
	schema: unknown;
	ms: number;
} {
	const t0 = performance.now();
	const sf = ts.createSourceFile(
		"subgraph.ts",
		SOURCE,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const arg = findDefineSubgraphArg(sf);
	if (!arg) throw new Error("no defineSubgraph({...}) call found");

	// Extract only the declarative metadata fields; skip `handlers` (functions).
	const out: Record<string, unknown> = {};
	for (const prop of arg.properties) {
		if (!ts.isPropertyAssignment(prop)) continue;
		const key = prop.name.getText(sf);
		if (key === "handlers") continue; // opaque; not needed for metadata
		out[key] = evalLiteral(prop.initializer);
	}
	const ms = performance.now() - t0;
	return {
		name: out.name as string,
		sources: out.sources,
		schema: out.schema,
		ms,
	};
}

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)] ?? 0;
}

async function main(): Promise<void> {
	console.log("f049 spike PoC — bundle-time definition extraction\n");

	// --- PATH A: execute (current behaviour) ---
	resetCanary();
	const execWarm = await runExecutePath(); // warm esbuild/import caches
	const execTimes: number[] = [];
	for (let i = 0; i < 20; i++) execTimes.push((await runExecutePath()).ms);
	const execFired = canaryFired();
	console.log("PATH A  execute (esbuild bundle + import())");
	console.log(`  extracted name : ${execWarm.name}`);
	console.log(`  secret exfil   : ${execFired ? "YES — LEAKED" : "no"}`);
	if (execFired) {
		console.log(
			`  canary         : ${readFileSync(canaryPath, "utf8").trim()}`,
		);
	}
	console.log(`  median latency : ${median(execTimes).toFixed(2)} ms\n`);

	// --- PATH B: AST-only (proposed) ---
	resetCanary();
	const astWarm = runAstPath();
	const astTimes: number[] = [];
	for (let i = 0; i < 20; i++) astTimes.push(runAstPath().ms);
	const astFired = canaryFired();
	console.log("PATH B  AST-extract (parse, never execute)");
	console.log(`  extracted name : ${astWarm.name}`);
	console.log(
		`  sources keys   : ${Object.keys(astWarm.sources as object).join(", ")}`,
	);
	console.log(
		`  schema keys    : ${Object.keys(astWarm.schema as object).join(", ")}`,
	);
	console.log(
		`  secret exfil   : ${astFired ? "YES — LEAKED" : "no — BLOCKED"}`,
	);
	console.log(`  median latency : ${median(astTimes).toFixed(3)} ms\n`);

	console.log("RESULT");
	console.log(
		`  execute path leaked secret : ${execFired}  (this is the live vuln)`,
	);
	console.log(
		`  AST path leaked secret     : ${astFired}  (proposed mitigation)`,
	);
	console.log(
		`  latency delta (A - B)      : ${(median(execTimes) - median(astTimes)).toFixed(2)} ms per call`,
	);

	rmSync(scratch, { recursive: true, force: true });
	if (execFired && !astFired) {
		console.log(
			"\nPoC PASS: AST extraction produced the same metadata with no code execution.",
		);
		process.exit(0);
	}
	console.log("\nPoC FAIL: unexpected canary state.");
	process.exit(1);
}

void main();
