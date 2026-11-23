/**
 * Comment ratchet. Product code (`packages/<name>/src`, `apps/web/src`, tests
 * excluded) carries no comments: names, types and tests say what code does.
 * Fails when a file has more comment lines than `comments.baseline.json`
 * records. The baseline only shrinks; run the /delete-comment skill to cut it.
 *
 * Exempt: tool directives (biome-ignore, @ts-*, pragmas), license headers,
 * and, in published packages, JSDoc on exported symbols and on type members
 * (openpkg specs + IDE hovers read it; that is customer documentation).
 *
 *   bun scripts/ci/comments.ts                 check (CI)
 *   bun scripts/ci/comments.ts --write         rewrite the baseline
 *   bun scripts/ci/comments.ts --list <path>   print every counted comment under path
 */
import { Glob } from "bun";
import ts from "typescript";

const ROOT = new URL("../../", import.meta.url).pathname;
const BASELINE = `${ROOT}scripts/ci/comments.baseline.json`;
const SCOPE = ["packages/*/src/**/*.{ts,tsx}", "apps/web/src/**/*.{ts,tsx}"];
const SKIP =
	/(^|\/)(node_modules|dist|generated|test|tests|__tests__)\/|\.(test|spec|type-test)\.tsx?$|test-preload\.tsx?$|\.d\.ts$/;
const DIRECTIVE =
	/^(\/\/\/?|\/\*+)\s*(biome-ignore|@ts-|eslint-|prettier-ignore|@jsx|@vitest|#region|#endregion|<reference|@__PURE__|#__PURE__|webpackChunkName|istanbul )/;
const LICENSE = /\b(license|copyright|spdx)\b/i;

type Comment = { line: number; endLine: number; text: string };

const published = new Map<string, boolean>();
async function isPublished(path: string): Promise<boolean> {
	const pkg = path.split("/").slice(0, 2).join("/");
	if (!published.has(pkg)) {
		const json = await Bun.file(`${ROOT}${pkg}/package.json`).json();
		published.set(pkg, json.private !== true);
	}
	return published.get(pkg) ?? false;
}

function isExported(statement: ts.Node): boolean {
	if (ts.isExportAssignment(statement) || ts.isExportDeclaration(statement))
		return true;
	return (
		ts.canHaveModifiers(statement) &&
		(ts.getModifiers(statement) ?? []).some(
			(m) => m.kind === ts.SyntaxKind.ExportKeyword,
		)
	);
}

function publicJsDocStarts(sf: ts.SourceFile): Set<number> {
	const starts = new Set<number>();
	const visit = (node: ts.Node, exported: boolean) => {
		for (const doc of (node as { jsDoc?: ts.JSDoc[] }).jsDoc ?? []) {
			if (exported || ts.isTypeElement(node)) starts.add(doc.pos);
		}
		ts.forEachChild(node, (child) => visit(child, exported));
	};
	for (const statement of sf.statements)
		visit(statement, isExported(statement));
	return starts;
}

function commentsOf(sf: ts.SourceFile, exempt: Set<number>): Comment[] {
	const text = sf.text;
	const seen = new Set<number>();
	const out: Comment[] = [];
	const collect = (ranges: ts.CommentRange[] | undefined) => {
		for (const r of ranges ?? []) {
			if (seen.has(r.pos)) continue;
			seen.add(r.pos);
			const body = text.slice(r.pos, r.end);
			if (exempt.has(r.pos) || DIRECTIVE.test(body) || LICENSE.test(body))
				continue;
			out.push({
				line: sf.getLineAndCharacterOfPosition(r.pos).line + 1,
				endLine: sf.getLineAndCharacterOfPosition(r.end).line + 1,
				text: body,
			});
		}
	};
	const walk = (node: ts.Node) => {
		if (node.kind === ts.SyntaxKind.JsxText) return;
		collect(ts.getLeadingCommentRanges(text, node.pos));
		collect(ts.getTrailingCommentRanges(text, node.end));
		for (const child of node.getChildren(sf)) walk(child);
	};
	walk(sf);
	return out.sort((a, b) => a.line - b.line);
}

async function scan(): Promise<Map<string, Comment[]>> {
	const files = new Map<string, Comment[]>();
	for (const pattern of SCOPE) {
		for await (const path of new Glob(pattern).scan({ cwd: ROOT })) {
			if (SKIP.test(path)) continue;
			const source = await Bun.file(ROOT + path).text();
			const sf = ts.createSourceFile(
				path,
				source,
				ts.ScriptTarget.Latest,
				true,
				path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
			);
			const exempt = (await isPublished(path))
				? publicJsDocStarts(sf)
				: new Set<number>();
			const comments = commentsOf(sf, exempt);
			if (comments.length > 0) files.set(path, comments);
		}
	}
	return files;
}

function lineCount(comments: Comment[]): number {
	const lines = new Set<number>();
	for (const c of comments)
		for (let l = c.line; l <= c.endLine; l++) lines.add(l);
	return lines.size;
}

const files = await scan();
const current = Object.fromEntries(
	[...files.entries()]
		.map(([path, comments]) => [path, lineCount(comments)] as const)
		.sort(([a], [b]) => (a < b ? -1 : 1)),
);
const total = Object.values(current).reduce((a, b) => a + b, 0);

const listIndex = process.argv.indexOf("--list");
if (listIndex !== -1) {
	const prefix = process.argv[listIndex + 1] ?? "";
	for (const [path, comments] of [...files.entries()].sort()) {
		if (!path.startsWith(prefix)) continue;
		const blocks: Comment[] = [];
		for (const c of comments) {
			const prev = blocks.at(-1);
			if (prev && c.line === prev.endLine + 1 && c.text.startsWith("//")) {
				blocks[blocks.length - 1] = {
					...prev,
					endLine: c.endLine,
					text: `${prev.text}\n${c.text}`,
				};
			} else blocks.push(c);
		}
		for (const b of blocks) console.log(`${path}:${b.line}\n${b.text}\n`);
	}
	process.exit(0);
}

if (process.argv.includes("--write")) {
	await Bun.write(BASELINE, `${JSON.stringify(current, null, "\t")}\n`);
	console.log(
		`comments: baseline written (${total} lines in ${Object.keys(current).length} files)`,
	);
	process.exit(0);
}

const baseline: Record<string, number> = await Bun.file(BASELINE).json();
const grown = Object.entries(current).filter(
	([path, count]) => count > (baseline[path] ?? 0),
);
if (grown.length > 0) {
	console.error(
		"comments: new comment lines in product code (encode it in names/types/tests, or delete):",
	);
	for (const [path, count] of grown) {
		console.error(`  ${path}: ${count} (baseline ${baseline[path] ?? 0})`);
	}
	process.exit(1);
}
const baselineTotal = Object.values(baseline).reduce((a, b) => a + b, 0);
const slack =
	baselineTotal > total
		? `; baseline can shrink by ${baselineTotal - total}, run --write`
		: "";
console.log(
	`comments: ok (${total} lines in ${Object.keys(current).length} files, none new${slack})`,
);
