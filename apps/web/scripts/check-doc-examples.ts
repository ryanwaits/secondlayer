/**
 * Docs examples must compile against the packages we ship. Every `ts` fence in
 * the docs' MDX that imports from `@secondlayer/*` is written to a scratch
 * project and type-checked with `tsc --noEmit`. A line marked `!error` gets
 * `// @ts-expect-error` above it, so the mistake a page shows has to really be
 * a compile error. Fences without such an import are fragments and are only
 * counted. Run: `bun run docs:check-examples` (needs the workspace built).
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import ts from "typescript";
import {
	parseAnnotations,
	parseFenceOptions,
} from "../src/lib/code/annotations";

const WEB = join(import.meta.dir, "..");
const ROOT = join(WEB, "src", "app", "(www)");
const WORK = join(WEB, "node_modules", ".cache", "docs-examples");
const FENCE = /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm;
const SHIPPED_IMPORT =
	/\bfrom\s+["']@secondlayer\/|\bimport\s*\(\s*["']@secondlayer\//;
/** Workspace packages resolve through their built `dist/`. */
const SHIPPED_PACKAGES = ["sdk", "stacks", "shared", "verify"];

export type Example = { where: string; file: string; source: string };

export type Report = {
	/** Fences type-checked and clean, plus those that failed. */
	checked: number;
	/** Fences set aside: no `@secondlayer/*` import, not whole TypeScript, or only missing names. */
	fragments: number;
	/** The fragments that imported a package but lean on names the page never shows. */
	ambient: string[];
	/** Failing fences the docs owners have not settled; the list can only shrink. */
	known: string[];
	failures: { where: string; message: string }[];
};

/** Errors that only say a snippet leans on its page: a name it never defines, or a top-level `return` (the fence is a function body). */
const IGNORED_CODES = new Set([
	"TS2304",
	"TS2552",
	"TS18004",
	"TS1108",
	"TS7006",
]);

/**
 * Fences that fail today and whose fix is the docs owners' call. Each entry is
 * a path, the fence's index in that file, and why. A fence that starts passing
 * must leave this list (the check fails until it does), so it can only shrink.
 */
const KNOWN_FAILING: { where: string; reason: string }[] = [];

/** An undeclared name is `any`, except a `db` handed to `kyselySink`: `any` there infers an `unknown` schema whose `keyof` is `never`. */
function ambientType(name: string, source: string): string {
	return name === "db" && /kyselySink\(\s*db\b/.test(source)
		? 'import("kysely").Kysely<any>'
		: "any";
}

/** `sl` is the client every docs page assumes; a fence that declares its own keeps it. */
const AMBIENT_SL = 'declare const sl: import("@secondlayer/sdk").SecondLayer; ';
const DECLARES_SL = /\b(?:const|let|var)\s+sl\b/;

/** A fence with `…` for elided code or a bare object body is a fragment: tsc cannot parse it, and a parse error would hide every type error after it. */
function parses(source: string): boolean {
	return !ts.transpileModule(source, {
		reportDiagnostics: true,
		compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
	}).diagnostics?.length;
}

/** A fence's TypeScript with annotations removed and `@ts-expect-error` above each `!error` line. */
export function exampleSource(body: string, lang: string): string {
	const { lines, annotations } = parseAnnotations(
		body.replace(/\n$/, ""),
		lang,
	);
	const expected = new Set(
		annotations
			.filter((a) => a.name === "error")
			.flatMap((a) =>
				Array.from({ length: a.to - a.from + 1 }, (_, i) => a.from + i),
			),
	);
	return lines
		.flatMap((line, i) =>
			expected.has(i)
				? [`${line.match(/^\s*/)?.[0] ?? ""}// @ts-expect-error`, line]
				: [line],
		)
		.join("\n");
}

/** Every checkable fence in the docs, and how many fragments were set aside. */
export function collectExamples(root = ROOT): {
	examples: Example[];
	fragments: number;
} {
	const examples: Example[] = [];
	let fragments = 0;
	for (const path of [...new Glob("**/*.mdx").scanSync(root)].sort()) {
		let n = 0;
		for (const m of readFileSync(join(root, path), "utf8").matchAll(FENCE)) {
			n++;
			// The changelog records past APIs; today's SDK is the wrong yardstick.
			if (path.startsWith("docs/changelog/")) continue;
			const lang = parseFenceOptions(m[2] ?? "").lang;
			if (lang !== "typescript" && lang !== "tsx") continue;
			const source = exampleSource(m[3] ?? "", lang);
			if (!SHIPPED_IMPORT.test(source) || !parses(source)) {
				fragments++;
				continue;
			}
			examples.push({
				where: `${path} fence ${n}`,
				file: `${String(examples.length + 1).padStart(3, "0")}.${lang === "tsx" ? "tsx" : "ts"}`,
				source,
			});
		}
	}
	return { examples, fragments };
}

const TSCONFIG = {
	compilerOptions: {
		target: "ES2022",
		lib: ["dom", "esnext"],
		module: "esnext",
		moduleResolution: "bundler",
		strict: true,
		noEmit: true,
		skipLibCheck: true,
		esModuleInterop: true,
		jsx: "react-jsx",
		types: ["bun", "node"],
		typeRoots: [
			join(WEB, "node_modules", "@types"),
			join(WEB, "..", "..", "node_modules", "@types"),
		],
	},
	include: ["*.ts", "*.tsx"],
};

/** Why the check cannot run, if it cannot: the workspace packages resolve through `dist/`. */
export function missingBuild(): string | null {
	const missing = SHIPPED_PACKAGES.filter(
		(p) => !existsSync(join(WEB, "..", "..", "packages", p, "dist")),
	);
	return missing.length
		? `Workspace packages are not built (no dist/ for ${missing.join(", ")}). Run \`bun run build\` at the repo root first.`
		: null;
}

type TscError = { code: string; line: number; message: string };

/** Type-check `files` (name to text) as one scratch project; errors by file name. */
async function runTsc(
	files: Map<string, string>,
): Promise<Map<string, TscError[]>> {
	rmSync(WORK, { recursive: true, force: true });
	mkdirSync(WORK, { recursive: true });
	writeFileSync(join(WORK, "tsconfig.json"), JSON.stringify(TSCONFIG, null, 2));
	for (const [file, text] of files)
		writeFileSync(join(WORK, file), `${text}\n`);
	const tsc = Bun.spawn(
		[
			process.execPath,
			"x",
			"tsc",
			"-p",
			join(WORK, "tsconfig.json"),
			"--pretty",
			"false",
		],
		{ cwd: WEB, stdout: "pipe", stderr: "pipe" },
	);
	const output = await new Response(tsc.stdout).text();
	await tsc.exited;
	const byFile = new Map<string, TscError[]>();
	for (const line of output.split("\n")) {
		const m = /^(?:.*\/)?(\d{3}\.tsx?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(
			line,
		);
		if (!m?.[1]) continue;
		byFile.set(m[1], [
			...(byFile.get(m[1]) ?? []),
			{
				code: m[3] ?? "",
				line: Number(m[2]),
				message: `line ${m[2]}: ${m[3]}: ${m[4]}`,
			},
		]);
	}
	return byFile;
}

/** The names tsc says a fence uses without defining. */
function missingNames(errors: TscError[]): string[] {
	return [
		...new Set(
			errors.flatMap((e) => {
				const name =
					/Cannot find name '([^']+)'/.exec(e.message)?.[1] ??
					/shorthand property '([^']+)'/.exec(e.message)?.[1];
				return name ? [name] : [];
			}),
		),
	];
}

export async function checkDocExamples(): Promise<Report> {
	const { examples, fragments } = collectExamples();
	const text = (e: Example, extra = "") =>
		`${extra}${DECLARES_SL.test(e.source) ? "" : AMBIENT_SL}${e.source}`;
	const first = await runTsc(new Map(examples.map((e) => [e.file, text(e)])));

	// A snippet leans on names its page never shows (`db`, `req`). Declare each
	// as `any` and check again: what still fails is the snippet's own fault, and
	// the errors that only followed from the unknown name are gone.
	const declared = new Map(
		examples.flatMap((e) => {
			const names = missingNames(first.get(e.file) ?? []);
			return names.length
				? [
						[
							e,
							names
								.map((n) => `declare const ${n}: ${ambientType(n, e.source)}; `)
								.join(""),
						] as const,
					]
				: [];
		}),
	);
	const second = await runTsc(
		new Map(
			examples.map((e) => [e.file, text(e, declared.get(e) ?? "")] as const),
		),
	);

	const ambient: string[] = [];
	const failures: Report["failures"] = [];
	const stale: string[] = [];
	for (const e of examples) {
		const real = (second.get(e.file) ?? []).filter(
			(err) => !IGNORED_CODES.has(err.code),
		);
		const known = KNOWN_FAILING.find((k) => k.where === e.where);
		if (!real.length) {
			if (known) stale.push(e.where);
			if (declared.has(e)) ambient.push(e.where);
		} else if (!known)
			for (const err of real)
				failures.push({ where: e.where, message: err.message });
	}
	for (const where of stale)
		failures.push({
			where,
			message: "now passes: remove it from KNOWN_FAILING",
		});
	const knownNow = examples.filter(
		(e) =>
			KNOWN_FAILING.some((k) => k.where === e.where) &&
			!stale.includes(e.where),
	).length;
	return {
		checked: examples.length - ambient.length - knownNow,
		fragments: fragments + ambient.length,
		ambient,
		known: KNOWN_FAILING.map((k) => `${k.where}: ${k.reason}`),
		failures,
	};
}

if (import.meta.main) {
	const problem = missingBuild();
	if (problem) {
		console.error(problem);
		process.exit(1);
	}
	const report = await checkDocExamples();
	console.log(
		`${report.checked} examples checked, ${report.fragments} fragments skipped, ${new Set(report.failures.map((f) => f.where)).size} failing`,
	);
	for (const k of report.known) console.log(`known failing: ${k}`);
	if (report.ambient.length)
		console.log(
			`fragments that use names the page never defines:\n  ${report.ambient.join("\n  ")}`,
		);
	for (const f of report.failures) console.error(`  ${f.where}: ${f.message}`);
	process.exit(report.failures.length ? 1 : 0);
}
