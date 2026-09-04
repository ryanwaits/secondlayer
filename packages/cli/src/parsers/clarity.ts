import { promises as fs } from "node:fs";
import type {
	AbiContract,
	AbiFunction,
	AbiFungibleToken,
	AbiMap,
	AbiNonFungibleToken,
	AbiType,
	AbiVariable,
	FunctionAccess,
	FunctionArg,
} from "@secondlayer/stacks/clarity";
import { normalizeAbi } from "@secondlayer/stacks/clarity";

/**
 * Read a contract ABI straight from Clarity source.
 *
 * Source carries declarations, not inferred types. Argument lists,
 * `define-map` key/value shapes and `define-data-var` types are written down,
 * so they can be read exactly. A function's RETURN type only exists after
 * Clarity's type checker has walked the body, so it cannot be read here at
 * all — this parser marks it {@link UNKNOWN}, which generators render as
 * `any`. An honest `any` fails at the call site; a guess (this used to answer
 * `bool` for every function) compiles and then fails on chain.
 *
 * For exact return types, point codegen at a deployed contract id or use the
 * `clarinet()` plugin, which pulls real ABIs out of simnet.
 */

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

type Node =
	| { kind: "atom"; value: string }
	| { kind: "list"; items: Node[] }
	| { kind: "tuple"; fields: Array<{ name: string; value: Node }> };

/** Characters that terminate an atom and stand on their own as tokens. */
const DELIMITERS = new Set(["(", ")", "{", "}", ",", ":"]);

function isWhitespace(char: string): boolean {
	return char === " " || char === "\t" || char === "\r" || char === "\n";
}

function isCommentStart(source: string, index: number): boolean {
	return source[index] === ";" && source[index + 1] === ";";
}

function tokenize(source: string): string[] {
	const tokens: string[] = [];
	let i = 0;

	while (i < source.length) {
		const char = source[i];

		if (isCommentStart(source, i)) {
			while (i < source.length && source[i] !== "\n") i++;
			continue;
		}

		if (isWhitespace(char)) {
			i++;
			continue;
		}

		// Keep string literals whole so their contents never look like syntax.
		if (char === '"') {
			let end = i + 1;
			while (end < source.length && source[end] !== '"') {
				if (source[end] === "\\") end++;
				end++;
			}
			tokens.push(source.slice(i, Math.min(end + 1, source.length)));
			i = end + 1;
			continue;
		}

		if (DELIMITERS.has(char)) {
			tokens.push(char);
			i++;
			continue;
		}

		let end = i;
		while (
			end < source.length &&
			!isWhitespace(source[end]) &&
			!DELIMITERS.has(source[end]) &&
			source[end] !== '"' &&
			!isCommentStart(source, end)
		) {
			end++;
		}
		tokens.push(source.slice(i, end));
		i = end;
	}

	return tokens;
}

/**
 * Parse Clarity source into s-expressions, with `{ key: type }` sugar read as
 * a tuple node so both tuple spellings reach {@link typeToAbi} the same way.
 */
function readForms(source: string): Node[] {
	const tokens = tokenize(source);
	let pos = 0;

	function readNode(): Node | null {
		const token = tokens[pos];
		if (token === undefined) return null;

		if (token === "(") {
			pos++;
			return { kind: "list", items: readList() };
		}
		if (token === "{") {
			pos++;
			return { kind: "tuple", fields: readTupleFields() };
		}
		// Stray closer or separator: consume it so the cursor always advances.
		if (DELIMITERS.has(token)) {
			pos++;
			return null;
		}

		pos++;
		return { kind: "atom", value: token };
	}

	function readList(): Node[] {
		const items: Node[] = [];
		while (pos < tokens.length && tokens[pos] !== ")") {
			const node = readNode();
			if (node) items.push(node);
		}
		pos++; // closing paren
		return items;
	}

	function readTupleFields(): Array<{ name: string; value: Node }> {
		const fields: Array<{ name: string; value: Node }> = [];
		while (pos < tokens.length && tokens[pos] !== "}") {
			const name = tokens[pos];
			pos++;
			if (name === "," || name === ":") continue;
			if (tokens[pos] === ":") pos++;
			const value = readNode();
			if (value) fields.push({ name, value });
		}
		pos++; // closing brace
		return fields;
	}

	const forms: Node[] = [];
	while (pos < tokens.length) {
		const node = readNode();
		if (node) forms.push(node);
	}
	return forms;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Stand-in for a type the source does not declare. Generators fall through to
 * `any` for unrecognized type names, and it is never handed to the runtime
 * converters (those only ever see argument and map-key types, which we do read
 * from source).
 */
const UNKNOWN = "unknown" as AbiType;

function atomToAbi(value: string): AbiType {
	switch (value) {
		case "uint":
		case "uint128":
			return "uint128";
		case "int":
		case "int128":
			return "int128";
		case "bool":
			return "bool";
		case "principal":
			return "principal";
		case "trait_reference":
			return "trait_reference";
		default:
			// `<sip-010-trait>` and friends.
			return value.startsWith("<") ? "trait_reference" : UNKNOWN;
	}
}

/** Sized types (`(buff 32)`) are only usable with their declared length. */
function readLength(node: Node | undefined): number | null {
	if (node?.kind !== "atom") return null;
	const length = Number.parseInt(node.value, 10);
	return Number.isSafeInteger(length) && length >= 0 ? length : null;
}

/** Read `(name type)` pairs into tuple fields, skipping malformed entries. */
function readFieldPairs(nodes: Node[]): Array<{ name: string; type: AbiType }> {
	return nodes.flatMap((node) => {
		if (node.kind !== "list") return [];
		const [name, type] = node.items;
		if (name?.kind !== "atom" || !type) return [];
		return [{ name: name.value, type: typeToAbi(type) }];
	});
}

function typeToAbi(node: Node): AbiType {
	if (node.kind === "atom") return atomToAbi(node.value);

	if (node.kind === "tuple") {
		return {
			tuple: node.fields.map((field) => ({
				name: field.name,
				type: typeToAbi(field.value),
			})),
		};
	}

	const [head, ...args] = node.items;
	if (!head) return UNKNOWN;

	// Legacy tuple spelling: `((name type) (name type))`.
	if (head.kind !== "atom") {
		const fields = readFieldPairs(node.items);
		return fields.length > 0 ? { tuple: fields } : UNKNOWN;
	}

	switch (head.value) {
		case "string-ascii": {
			const length = readLength(args[0]);
			return length === null ? UNKNOWN : { "string-ascii": { length } };
		}
		case "string-utf8": {
			const length = readLength(args[0]);
			return length === null ? UNKNOWN : { "string-utf8": { length } };
		}
		case "buff": {
			const length = readLength(args[0]);
			return length === null ? UNKNOWN : { buff: { length } };
		}
		case "optional":
			return args[0] ? { optional: typeToAbi(args[0]) } : UNKNOWN;
		case "list": {
			const length = readLength(args[0]);
			if (length === null || !args[1]) return UNKNOWN;
			return { list: { length, type: typeToAbi(args[1]) } };
		}
		case "response":
			return args[0] && args[1]
				? { response: { ok: typeToAbi(args[0]), error: typeToAbi(args[1]) } }
				: UNKNOWN;
		case "tuple": {
			const fields = readFieldPairs(args);
			return fields.length > 0 ? { tuple: fields } : UNKNOWN;
		}
		default:
			return UNKNOWN;
	}
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

const FUNCTION_ACCESS: Record<string, FunctionAccess> = {
	"define-public": "public",
	"define-read-only": "read-only",
	"define-private": "private",
};

function toFunction(form: Node[], access: FunctionAccess): AbiFunction | null {
	const signature = form[1];
	if (signature?.kind !== "list") return null;

	const [nameNode, ...argNodes] = signature.items;
	if (nameNode?.kind !== "atom") return null;

	const args: FunctionArg[] = argNodes.flatMap((node) => {
		if (node.kind !== "list") return [];
		const [name, type] = node.items;
		if (name?.kind !== "atom" || !type) return [];
		return [{ name: name.value, type: typeToAbi(type) }];
	});

	return {
		name: nameNode.value,
		access,
		args,
		// Clarity guarantees `define-public` returns a response; the payload
		// types need the type checker, so they stay unknown rather than guessed.
		outputs:
			access === "public"
				? { response: { ok: UNKNOWN, error: UNKNOWN } }
				: UNKNOWN,
	};
}

/** `(define-map name key value)` — both shapes are declared in source. */
function toMap(form: Node[]): AbiMap | null {
	const [, nameNode, key, value] = form;
	if (nameNode?.kind !== "atom" || !key || !value) return null;
	return { name: nameNode.value, key: typeToAbi(key), value: typeToAbi(value) };
}

/** `(define-data-var name type initial-value)`. */
function toVariable(form: Node[]): AbiVariable | null {
	const [, nameNode, type] = form;
	if (nameNode?.kind !== "atom" || !type) return null;
	return { name: nameNode.value, type: typeToAbi(type), access: "variable" };
}

/** `(define-fungible-token name [max-supply])`. */
function toFungibleToken(form: Node[]): AbiFungibleToken | null {
	const nameNode = form[1];
	if (nameNode?.kind !== "atom") return null;
	return { name: nameNode.value };
}

/** `(define-non-fungible-token name identifier-type)`. */
function toNonFungibleToken(form: Node[]): AbiNonFungibleToken | null {
	const [, nameNode, type] = form;
	if (nameNode?.kind !== "atom") return null;
	return { name: nameNode.value, type: type ? typeToAbi(type) : UNKNOWN };
}

export function parseClarityContent(content: string): AbiContract {
	const functions: AbiFunction[] = [];
	const maps: AbiMap[] = [];
	const variables: AbiVariable[] = [];
	const fungibleTokens: AbiFungibleToken[] = [];
	const nonFungibleTokens: AbiNonFungibleToken[] = [];
	const implementedTraits: string[] = [];

	for (const form of readForms(content)) {
		if (form.kind !== "list") continue;
		const head = form.items[0];
		if (head?.kind !== "atom") continue;

		const access = FUNCTION_ACCESS[head.value];
		if (access) {
			const func = toFunction(form.items, access);
			if (func) functions.push(func);
			continue;
		}

		switch (head.value) {
			case "define-map": {
				const map = toMap(form.items);
				if (map) maps.push(map);
				break;
			}
			case "define-data-var": {
				const variable = toVariable(form.items);
				if (variable) variables.push(variable);
				break;
			}
			case "define-fungible-token": {
				const token = toFungibleToken(form.items);
				if (token) fungibleTokens.push(token);
				break;
			}
			case "define-non-fungible-token": {
				const token = toNonFungibleToken(form.items);
				if (token) nonFungibleTokens.push(token);
				break;
			}
			case "impl-trait": {
				const trait = form.items[1];
				if (trait?.kind === "atom") {
					implementedTraits.push(trait.value.replace(/^'/, ""));
				}
				break;
			}
		}
	}

	return {
		functions,
		...(maps.length > 0 && { maps }),
		...(variables.length > 0 && { variables }),
		...(fungibleTokens.length > 0 && { fungible_tokens: fungibleTokens }),
		...(nonFungibleTokens.length > 0 && {
			non_fungible_tokens: nonFungibleTokens,
		}),
		...(implementedTraits.length > 0 && {
			implemented_traits: implementedTraits,
		}),
	};
}

export async function parseClarityFile(filePath: string): Promise<AbiContract> {
	try {
		const content = await fs.readFile(filePath, "utf-8");
		const result = parseClarityContent(content);

		if (result.functions.length === 0) {
			console.warn(
				`⚠️  No functions found in ${filePath}. For complex contracts, deploy first and use the contract address instead.`,
			);
		}

		return result;
	} catch (error) {
		throw new Error(
			`Unable to parse ${filePath}. For complex contracts, deploy first and use the contract address instead.\nOriginal error: ${error}`,
		);
	}
}

/**
 * Parse ABI from API response
 * Uses normalizeAbi from @secondlayer/stacks/clarity for consistent handling of different ABI formats
 */
// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export function parseApiResponse(apiResponse: any): AbiContract {
	try {
		return normalizeAbi(apiResponse);
	} catch (error) {
		throw new Error(`Failed to parse API response: ${error}`);
	}
}
