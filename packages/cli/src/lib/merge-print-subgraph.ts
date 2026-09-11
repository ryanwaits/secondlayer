/**
 * Merge print-schema sources into an existing static defineSubgraph file
 * without executing user code. Uses bundler extract + TypeScript AST splice.
 */

import {
	SubgraphNotStaticError,
	extractSubgraphDefinition,
} from "@secondlayer/bundler";
import {
	type PrintScaffoldInput,
	generatePrintSchemaSubgraph,
} from "@secondlayer/scaffold";
import ts from "typescript";

function findDefineArg(sf: ts.SourceFile): ts.ObjectLiteralExpression {
	let found: ts.ObjectLiteralExpression | undefined;
	const visit = (node: ts.Node) => {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === "defineSubgraph" &&
			node.arguments[0] &&
			ts.isObjectLiteralExpression(node.arguments[0])
		) {
			if (found) {
				throw new Error("multiple defineSubgraph calls");
			}
			found = node.arguments[0];
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	if (!found) {
		throw new Error("no defineSubgraph({...}) found");
	}
	return found;
}

function keyText(name: ts.PropertyName, sf: ts.SourceFile): string {
	if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
		return name.text;
	}
	return name.getText(sf);
}

function objectProp(
	arg: ts.ObjectLiteralExpression,
	key: string,
	sf: ts.SourceFile,
): ts.ObjectLiteralExpression | undefined {
	for (const prop of arg.properties) {
		if (!ts.isPropertyAssignment(prop)) continue;
		if (keyText(prop.name, sf) !== key) continue;
		if (ts.isObjectLiteralExpression(prop.initializer)) {
			return prop.initializer;
		}
	}
	return undefined;
}

/**
 * Append print-schema sources/schema/handlers for `input.contractId` into
 * `existingCode`. Keeps the existing subgraph `name`. Collision suffixes use
 * the same deduper as print-scaffold.
 */
export function mergePrintSchemaIntoFile(
	existingCode: string,
	input: Omit<
		PrintScaffoldInput,
		"name" | "reservedSourceKeys" | "reservedTableNames"
	>,
): string {
	let extracted: ReturnType<typeof extractSubgraphDefinition>;
	try {
		extracted = extractSubgraphDefinition(existingCode);
	} catch (err) {
		if (err instanceof SubgraphNotStaticError) {
			throw new Error(
				`cannot merge: subgraph is not a static defineSubgraph({...}) literal (${err.message}). Paste a new source by hand.`,
			);
		}
		throw err;
	}

	const name = typeof extracted.name === "string" ? extracted.name : undefined;
	if (!name) {
		throw new Error("cannot merge: existing subgraph has no static name");
	}

	const reservedSourceKeys = Object.keys(
		(extracted.sources as Record<string, unknown> | undefined) ?? {},
	);
	const reservedTableNames = Object.keys(
		(extracted.schema as Record<string, unknown> | undefined) ?? {},
	);

	const addition = generatePrintSchemaSubgraph({
		...input,
		name,
		reservedSourceKeys,
		reservedTableNames,
	});

	const existingSf = ts.createSourceFile(
		"existing.ts",
		existingCode,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const additionSf = ts.createSourceFile(
		"addition.ts",
		addition,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const existingArg = findDefineArg(existingSf);
	const additionArg = findDefineArg(additionSf);

	const splices: { at: number; text: string }[] = [];
	for (const key of ["sources", "schema", "handlers"] as const) {
		const existingObj = objectProp(existingArg, key, existingSf);
		const additionObj = objectProp(additionArg, key, additionSf);
		if (!existingObj || !additionObj) {
			throw new Error(
				`cannot merge: both files need a static ${key} object literal`,
			);
		}
		const newProps = additionObj.properties.map((p) => p.getText(additionSf));
		if (newProps.length === 0) continue;

		const insertAt = existingObj.end - 1;
		let prefix = "\n";
		if (existingObj.properties.length > 0) {
			const last = existingObj.properties[existingObj.properties.length - 1];
			if (!last) throw new Error("unreachable");
			const between = existingCode.slice(last.end, existingObj.end - 1);
			prefix = between.includes(",") ? "\n" : ",\n";
		}
		splices.push({ at: insertAt, text: `${prefix}${newProps.join(",\n")}` });
	}

	splices.sort((a, b) => b.at - a.at);
	let result = existingCode;
	for (const s of splices) {
		result = result.slice(0, s.at) + s.text + result.slice(s.at);
	}
	return result;
}
