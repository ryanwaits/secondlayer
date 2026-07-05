import ts from "typescript";

/**
 * Declarative subgraph metadata read via AST parsing — never executed.
 *
 * `handlerSources` holds each handler's SOURCE TEXT (never the function
 * itself) keyed by source name; it exists only for the advisory print-field
 * lint, which just regex-scans stringified handler bodies either way.
 */
export interface ExtractedSubgraph {
	name?: unknown;
	version?: unknown;
	description?: unknown;
	startBlock?: unknown;
	backfillMode?: unknown;
	sources?: unknown;
	schema?: unknown;
	/** Per-key handler SOURCE TEXT (never executed). Used only by the print lint. */
	handlerSources: Record<string, string>;
}

/** Thrown when the definition isn't statically analyzable. Callers map to 400. */
export class SubgraphNotStaticError extends Error {}

const META_KEYS = [
	"name",
	"version",
	"description",
	"startBlock",
	"backfillMode",
	"sources",
	"schema",
] as const;

/**
 * Parse subgraph source (raw TS or esbuild-bundled ESM) and return its
 * declarative metadata WITHOUT executing a single line of user code. The
 * source must contain exactly one `defineSubgraph({...})` call with an
 * object-literal argument whose relevant properties are static literals.
 */
export function extractSubgraphDefinition(code: string): ExtractedSubgraph {
	const sf = ts.createSourceFile(
		"subgraph.ts",
		code,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const arg = findSoleDefineSubgraphArg(sf);

	const out: ExtractedSubgraph = { handlerSources: {} };
	for (const prop of arg.properties) {
		if (!ts.isPropertyAssignment(prop)) {
			throw new SubgraphNotStaticError(
				`non-literal property in defineSubgraph({...}) (${ts.SyntaxKind[prop.kind]})`,
			);
		}
		const key = keyText(prop.name, sf);
		if (key === "handlers") {
			if (ts.isObjectLiteralExpression(prop.initializer)) {
				for (const h of prop.initializer.properties) {
					const hKey =
						ts.isPropertyAssignment(h) ||
						ts.isMethodDeclaration(h) ||
						ts.isShorthandPropertyAssignment(h)
							? keyText(h.name, sf)
							: undefined;
					if (hKey) out.handlerSources[hKey] = h.getText(sf);
				}
			}
			continue;
		}
		if ((META_KEYS as readonly string[]).includes(key)) {
			(out as unknown as Record<string, unknown>)[key] = evalLiteral(
				prop.initializer,
				sf,
			);
		}
		// Unknown keys are ignored (validator's .strict() on filters still guards sources).
	}
	return out;
}

/** For `ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)` return the
 * bare text; otherwise fall back to the identifier's source text. Both
 * quoted and unquoted keys resolve to the same bare key. */
function keyText(name: ts.PropertyName, sf: ts.SourceFile): string {
	if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
		return name.text;
	}
	return name.getText(sf);
}

/**
 * Statically evaluate a literal subset of expressions. Throws
 * `SubgraphNotStaticError` on anything that isn't a plain literal — this is
 * the security boundary: no branch here may execute user code.
 */
function evalLiteral(node: ts.Expression, sf: ts.SourceFile): unknown {
	if (ts.isStringLiteralLike(node)) return node.text;
	if (ts.isNumericLiteral(node)) return Number(node.text);
	if (ts.isBigIntLiteral(node)) return BigInt(node.text.replace(/n$/, ""));
	if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
	if (node.kind === ts.SyntaxKind.NullKeyword) return null;

	if (
		ts.isPrefixUnaryExpression(node) &&
		node.operator === ts.SyntaxKind.MinusToken
	) {
		const operand = node.operand;
		if (ts.isNumericLiteral(operand)) return -Number(operand.text);
		if (ts.isBigIntLiteral(operand))
			return -BigInt(operand.text.replace(/n$/, ""));
		throw new SubgraphNotStaticError(
			`non-literal expression: ${ts.SyntaxKind[node.kind]}`,
		);
	}

	if (ts.isArrayLiteralExpression(node)) {
		return node.elements.map((el) => {
			if (
				!ts.isExpression(el) ||
				ts.isSpreadElement(el) ||
				ts.isOmittedExpression(el)
			) {
				throw new SubgraphNotStaticError(
					`non-literal array element: ${ts.SyntaxKind[el.kind]}`,
				);
			}
			return evalLiteral(el, sf);
		});
	}

	if (ts.isObjectLiteralExpression(node)) {
		const obj: Record<string, unknown> = {};
		for (const prop of node.properties) {
			if (!ts.isPropertyAssignment(prop)) {
				throw new SubgraphNotStaticError(
					`non-literal object property: ${ts.SyntaxKind[prop.kind]}`,
				);
			}
			obj[keyText(prop.name, sf)] = evalLiteral(prop.initializer, sf);
		}
		return obj;
	}

	throw new SubgraphNotStaticError(
		`non-literal expression: ${ts.SyntaxKind[node.kind]}`,
	);
}

/**
 * Find the sole top-level `defineSubgraph({...})` call in the source.
 * Throws on zero or more than one match — never guesses.
 */
function findSoleDefineSubgraphArg(
	sf: ts.SourceFile,
): ts.ObjectLiteralExpression {
	const matches: ts.ObjectLiteralExpression[] = [];

	function visit(node: ts.Node): void {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === "defineSubgraph" &&
			node.arguments.length === 1 &&
			ts.isObjectLiteralExpression(node.arguments[0])
		) {
			matches.push(node.arguments[0] as ts.ObjectLiteralExpression);
		}
		ts.forEachChild(node, visit);
	}
	visit(sf);

	if (matches.length === 0) {
		throw new SubgraphNotStaticError(
			"no defineSubgraph({...}) call with an object-literal argument found",
		);
	}
	if (matches.length > 1) {
		throw new SubgraphNotStaticError(
			"multiple defineSubgraph({...}) calls found; expected exactly one",
		);
	}
	const match = matches[0];
	if (!match) {
		throw new SubgraphNotStaticError(
			"no defineSubgraph({...}) call with an object-literal argument found",
		);
	}
	return match;
}
