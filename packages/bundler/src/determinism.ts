import {
	ALLOWED_GLOBALS,
	ALLOWED_MATH,
	FORBIDDEN_GLOBALS,
	type HandlerFinding,
	LOCALE_METHODS,
} from "@secondlayer/subgraphs/verification";
import ts from "typescript";

/** The subset of a v3 sourcemap the scan reads. */
export interface ScanSourceMap {
	sources: string[];
	mappings: string;
}

export interface DeterminismScanOptions {
	/** File name reported when no sourcemap maps a position. Default `handler.js`. */
	file?: string;
	/** Maps bundle positions back to the author's files. */
	sourceMap?: ScanSourceMap;
}

const ALLOWED: ReadonlySet<string> = new Set(ALLOWED_GLOBALS);
const MATH_OK: ReadonlySet<string> = new Set(ALLOWED_MATH);
const LOCALE: ReadonlySet<string> = new Set(LOCALE_METHODS);

/**
 * Statically scan bundled handler code (esbuild ESM output) against the
 * determinism contract: forbidden or unknown globals, inexact `Math`,
 * locale-sensitive methods, code generation, imports left unbundled, and
 * `ctx.client` reads (which need L3). Never executes the code.
 *
 * Scoping is deliberately coarse: any name declared anywhere in the bundle
 * counts as local everywhere. That can miss a global hidden behind a
 * same-named local elsewhere (the runtime realm still catches it) but never
 * flags a local as a global, so it cannot fail a deploy that is clean.
 */
export function scanHandlerDeterminism(
	code: string,
	opts: DeterminismScanOptions = {},
): HandlerFinding[] {
	const sf = ts.createSourceFile(
		"handler.js",
		code,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	);
	const declared = collectDeclaredNames(sf);
	const locate = positionMapper(sf, opts);
	const findings: HandlerFinding[] = [];
	const seen = new Set<string>();
	const report = (
		node: ts.Node,
		kind: HandlerFinding["kind"],
		name: string,
		reason: string,
	) => {
		const at = locate(node.getStart(sf));
		const key = `${name}@${at.file}:${at.line}:${at.column}`;
		if (seen.has(key)) return;
		seen.add(key);
		findings.push({ kind, name, reason, ...at });
	};

	const visit = (node: ts.Node): void => {
		if (ts.isIdentifier(node) && isReference(node)) {
			checkGlobal(node);
		} else if (ts.isPropertyAccessExpression(node)) {
			const member = node.name.text;
			if (LOCALE.has(member)) {
				report(
					node.name,
					"nondeterministic",
					member,
					"output depends on the host's locale data",
				);
			} else if (member === "client") {
				report(
					node.name,
					"needs-l3",
					"ctx.client",
					"contract reads need L3 proofs",
				);
			}
		} else if (ts.isBindingElement(node)) {
			const key = node.propertyName ?? node.name;
			if (ts.isIdentifier(key) && key.text === "client") {
				report(key, "needs-l3", "ctx.client", "contract reads need L3 proofs");
			}
		} else if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword
		) {
			report(
				node,
				"nondeterministic",
				"import()",
				"dynamic imports load host modules at run time",
			);
		} else if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			report(
				node,
				"nondeterministic",
				`import "${node.moduleSpecifier.text}"`,
				"imports must be bundled into the handler",
			);
		} else if (
			ts.isMetaProperty(node) &&
			node.keywordToken === ts.SyntaxKind.ImportKeyword
		) {
			report(
				node,
				"nondeterministic",
				"import.meta",
				"host module metadata differs per run",
			);
		} else if (
			(ts.isCallExpression(node) || ts.isNewExpression(node)) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === "Function" &&
			!declared.has("Function")
		) {
			report(
				node,
				"nondeterministic",
				"Function()",
				"generated code hides inputs from the scan",
			);
		}
		ts.forEachChild(node, visit);
	};

	const checkGlobal = (id: ts.Identifier): void => {
		const name = id.text;
		if (declared.has(name)) return;
		const forbidden = FORBIDDEN_GLOBALS[name];
		if (forbidden) {
			report(id, "nondeterministic", name, forbidden);
			return;
		}
		if (ALLOWED.has(name)) {
			if (name === "Math") checkMath(id);
			return;
		}
		// `typeof window` is the portable probe; it never reads the global.
		if (ts.isTypeOfExpression(id.parent)) return;
		report(id, "nondeterministic", name, "not in the deterministic allow-list");
	};

	const checkMath = (id: ts.Identifier): void => {
		const parent = id.parent;
		if (ts.isPropertyAccessExpression(parent) && parent.expression === id) {
			const member = parent.name.text;
			if (!MATH_OK.has(member)) {
				report(
					parent,
					"nondeterministic",
					`Math.${member}`,
					member === "random"
						? "randomness differs per run"
						: "result is engine-approximated",
				);
			}
		} else if (
			ts.isElementAccessExpression(parent) &&
			parent.expression === id
		) {
			report(
				parent,
				"nondeterministic",
				"Math[…]",
				"computed access hides which member is used",
			);
		}
	};

	visit(sf);
	return findings;
}

/** Every name bound anywhere in the file (flat, see the scan's doc). */
function collectDeclaredNames(sf: ts.SourceFile): Set<string> {
	const names = new Set<string>(["arguments"]);
	const addBinding = (name: ts.BindingName | undefined) => {
		if (!name) return;
		if (ts.isIdentifier(name)) {
			names.add(name.text);
			return;
		}
		for (const el of name.elements) {
			if (ts.isBindingElement(el)) addBinding(el.name);
		}
	};
	const visit = (node: ts.Node): void => {
		if (
			ts.isVariableDeclaration(node) ||
			ts.isParameter(node) ||
			ts.isBindingElement(node)
		) {
			addBinding(node.name);
		} else if (
			(ts.isFunctionDeclaration(node) ||
				ts.isFunctionExpression(node) ||
				ts.isClassDeclaration(node) ||
				ts.isClassExpression(node)) &&
			node.name
		) {
			names.add(node.name.text);
		} else if (
			ts.isImportClause(node) ||
			ts.isImportSpecifier(node) ||
			ts.isNamespaceImport(node)
		) {
			if (node.name) names.add(node.name.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return names;
}

/** True when the identifier reads a binding (rather than naming a property,
 *  label, declaration or import/export specifier). */
function isReference(id: ts.Identifier): boolean {
	const p = id.parent;
	if (!p) return false;
	if (ts.isPropertyAccessExpression(p)) return p.expression === id;
	if (ts.isQualifiedName(p)) return false;
	if (
		ts.isPropertyAssignment(p) ||
		ts.isMethodDeclaration(p) ||
		ts.isPropertyDeclaration(p) ||
		ts.isGetAccessorDeclaration(p) ||
		ts.isSetAccessorDeclaration(p) ||
		ts.isEnumMember(p)
	) {
		return p.name !== id;
	}
	if (ts.isBindingElement(p)) return p.initializer === id;
	if (
		ts.isVariableDeclaration(p) ||
		ts.isParameter(p) ||
		ts.isFunctionDeclaration(p) ||
		ts.isFunctionExpression(p) ||
		ts.isClassDeclaration(p) ||
		ts.isClassExpression(p)
	) {
		return p.name !== id;
	}
	if (
		ts.isLabeledStatement(p) ||
		ts.isBreakStatement(p) ||
		ts.isContinueStatement(p) ||
		ts.isImportClause(p) ||
		ts.isImportSpecifier(p) ||
		ts.isNamespaceImport(p) ||
		ts.isExportSpecifier(p) ||
		ts.isMetaProperty(p)
	) {
		return false;
	}
	return true;
}

// ── Sourcemap ───────────────────────────────────────────────────────────

type Segment = [genCol: number, src: number, line: number, col: number];

function positionMapper(
	sf: ts.SourceFile,
	opts: DeterminismScanOptions,
): (pos: number) => { file: string; line: number; column: number } {
	const fallbackFile = opts.file ?? "handler.js";
	const lines = opts.sourceMap ? decodeMappings(opts.sourceMap.mappings) : [];
	return (pos) => {
		const { line, character } = sf.getLineAndCharacterOfPosition(pos);
		const segs = lines[line];
		let hit: Segment | undefined;
		for (const seg of segs ?? []) {
			if (seg[0] > character) break;
			hit = seg;
		}
		const source = hit && opts.sourceMap?.sources[hit[1]];
		if (hit && source !== undefined) {
			return { file: source, line: hit[2] + 1, column: hit[3] + 1 };
		}
		return { file: fallbackFile, line: line + 1, column: character + 1 };
	};
}

const BASE64 =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decode v3 `mappings` into per-generated-line segments, sorted by column. */
function decodeMappings(mappings: string): Segment[][] {
	const out: Segment[][] = [];
	let src = 0;
	let srcLine = 0;
	let srcCol = 0;
	for (const lineText of mappings.split(";")) {
		const segs: Segment[] = [];
		let genCol = 0;
		for (const segText of lineText.split(",")) {
			if (!segText) continue;
			const v = decodeVlq(segText);
			genCol += v[0] ?? 0;
			if (v.length >= 4) {
				src += v[1] ?? 0;
				srcLine += v[2] ?? 0;
				srcCol += v[3] ?? 0;
				segs.push([genCol, src, srcLine, srcCol]);
			}
		}
		out.push(segs);
	}
	return out;
}

function decodeVlq(text: string): number[] {
	const values: number[] = [];
	let value = 0;
	let shift = 0;
	for (const ch of text) {
		const digit = BASE64.indexOf(ch);
		value += (digit & 31) * 2 ** shift;
		if (digit & 32) {
			shift += 5;
			continue;
		}
		values.push(value % 2 === 1 ? -Math.floor(value / 2) : value / 2);
		value = 0;
		shift = 0;
	}
	return values;
}
