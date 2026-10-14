/**
 * openpkg JSON schema → TypeScript type text.
 *
 * openpkg describes types as JSON Schema plus `x-ts-*` hints. This turns that
 * back into the TypeScript a reader would write, following `$ref` names,
 * type arguments, unions, intersections and inline object literals instead of
 * collapsing them to `object` / `unknown`.
 */

export type Schema = {
	$ref?: string;
	type?: string | string[];
	enum?: unknown[];
	const?: unknown;
	items?: Schema;
	properties?: Record<string, Schema>;
	additionalProperties?: Schema | boolean;
	required?: string[];
	allOf?: Schema[];
	anyOf?: Schema[];
	oneOf?: Schema[];
	description?: string;
	"x-ts-type"?: string;
	"x-ts-declared"?: string;
	"x-ts-type-arguments"?: Schema[];
	"x-ts-function"?: boolean;
	"x-ts-signatures"?: Signature[];
	"x-ts-readonly"?: boolean;
	"x-ts-package"?: string;
	"x-ts-type-predicate"?: { parameterName: string; type: Schema };
};

export type Param = {
	name: string;
	schema?: Schema;
	required?: boolean;
	description?: string;
	default?: unknown;
};

export type TypeParameter = {
	name: string;
	constraint?: string;
	default?: string;
	const?: boolean;
};

export type Tag = { name: string; text?: string };

export type Signature = {
	parameters?: Param[];
	returns?: { schema?: Schema; description?: string };
	description?: string;
	typeParameters?: TypeParameter[];
	overloadIndex?: number;
	tags?: Tag[];
};

export type RenderContext = {
	/** Type names that exist in the spec; `x-ts-declared` aliases resolve only to these. */
	known: ReadonlySet<string>;
	/** Receives every named type the rendered text mentions. */
	refs?: Set<string>;
	/** Receives names of external (stubbed) types so callers skip expanding them. */
	external?: Set<string>;
};

type Rendered = {
	text: string;
	/** Precedence: how the text must be wrapped when nested in another type. */
	kind: "atom" | "union" | "intersection" | "function";
};

const BARE_NAME = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** `#/types/base.FetchLike` → `FetchLike`. */
export function refName(ref: string): string {
	const last = ref.split("/").pop() ?? ref;
	return last.includes(".") ? (last.split(".").pop() ?? last) : last;
}

function atom(text: string): Rendered {
	return { text, kind: "atom" };
}

function wrap(r: Rendered, inside: "union" | "intersection" | "array"): string {
	if (r.kind === "atom") return r.text;
	if (inside === "array") return `(${r.text})`;
	if (r.kind === "function") return `(${r.text})`;
	if (inside === "intersection" && r.kind === "union") return `(${r.text})`;
	return r.text;
}

function literal(value: unknown): string {
	return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function isNullish(s: Schema): boolean {
	return s.type === "null";
}

function propertyKey(name: string): string {
	return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

function typeArguments(schema: Schema, ctx: RenderContext): string {
	const args = schema["x-ts-type-arguments"];
	if (!args?.length) return "";
	return `<${args.map((a) => render(a, ctx).text).join(", ")}>`;
}

function renderObjectLiteral(schema: Schema, ctx: RenderContext): string {
	const props = Object.entries(schema.properties ?? {});
	const required = new Set(schema.required ?? []);
	const members = props.map(
		([name, value]) =>
			`${propertyKey(name)}${required.has(name) ? "" : "?"}: ${render(value, ctx).text}`,
	);
	const extra = schema.additionalProperties;
	if (extra && typeof extra === "object") {
		members.push(`[key: string]: ${render(extra, ctx).text}`);
	}
	return members.length ? `{ ${members.join("; ")} }` : "{}";
}

/** `(a: A, b?: B)` for one signature's parameters. */
export function renderParams(params: Param[] | undefined, ctx: RenderContext) {
	return (params ?? [])
		.map(
			(p) =>
				`${p.name}${p.required === false ? "?" : ""}: ${render(p.schema, ctx).text}`,
		)
		.join(", ");
}

/** The return type of a signature, including `x is T` type predicates. */
export function renderReturns(
	returns: Signature["returns"],
	ctx: RenderContext,
): string {
	const predicate = returns?.schema?.["x-ts-type-predicate"];
	if (predicate) {
		return `${predicate.parameterName} is ${render(predicate.type, ctx).text}`;
	}
	return render(returns?.schema, ctx).text;
}

function renderTypeParams(params: TypeParameter[] | undefined): string {
	if (!params?.length) return "";
	const text = params.map((p) => {
		const parts = [`${p.const ? "const " : ""}${p.name}`];
		if (p.constraint) parts.push(`extends ${p.constraint}`);
		const head = parts.join(" ");
		return p.default ? `${head} = ${p.default}` : head;
	});
	return `<${text.join(", ")}>`;
}

/** `<const T extends X>(params: P) => R`, used for function-typed schemas. */
function renderSignature(
	sig: Signature,
	ctx: RenderContext,
	arrow: "=>" | ":",
): string {
	return `${renderTypeParams(sig.typeParameters)}(${renderParams(sig.parameters, ctx)})${arrow === "=>" ? " =>" : ":"} ${renderReturns(sig.returns, ctx)}`;
}

/** Full declaration text for one overload: `name<T>(a: A): R`. */
export function renderDeclaration(
	name: string,
	sig: Signature,
	ctx: RenderContext,
): string {
	return `${name}${renderSignature(sig, ctx, ":")}`;
}

function render(schema: Schema | undefined, ctx: RenderContext): Rendered {
	if (!schema) return atom("unknown");

	if (schema.$ref) {
		const name = refName(schema.$ref);
		ctx.refs?.add(name);
		if (schema["x-ts-package"]) ctx.external?.add(name);
		return atom(`${name}${typeArguments(schema, ctx)}`);
	}

	// An alias the author wrote (`StreamsFilterValue`) reads better than its
	// expansion. Only trusted when it names a real type, never a type parameter.
	const declared = schema["x-ts-declared"];
	if (declared && IDENTIFIER.test(declared) && ctx.known.has(declared)) {
		ctx.refs?.add(declared);
		return atom(declared);
	}

	const tsType = schema["x-ts-type"];

	if (schema["x-ts-function"]) {
		const sigs = schema["x-ts-signatures"];
		if (sigs?.length === 1 && sigs[0]) {
			return {
				text: renderSignature(sigs[0], ctx, "=>"),
				kind: "function",
			};
		}
		if (tsType) return { text: tsType, kind: "function" };
	}

	if (schema.allOf?.length) {
		const arms = schema.allOf.map((a) => render(a, ctx));
		const [only] = arms;
		if (arms.length === 1 && only) return only;
		return {
			text: arms.map((a) => wrap(a, "intersection")).join(" & "),
			kind: "intersection",
		};
	}

	const union = schema.anyOf ?? schema.oneOf;
	if (union?.length) {
		// openpkg stops expanding arms once its schema budget runs out (an array
		// loses its `items`), but the node's own text is still the real type.
		if (tsType) {
			// Still walk the arms so referenced types are recorded.
			for (const arm of union) render(arm, ctx);
			return { text: tsType, kind: "union" };
		}
		const ordered = [...union].sort(
			(a, b) => Number(isNullish(a)) - Number(isNullish(b)),
		);
		const seen = new Set<string>();
		const arms: Rendered[] = [];
		for (const arm of ordered) {
			const r = render(arm, ctx);
			if (seen.has(r.text)) continue;
			seen.add(r.text);
			arms.push(r);
		}
		const [only] = arms;
		if (arms.length === 1 && only) return only;
		return {
			text: arms.map((a) => wrap(a, "union")).join(" | "),
			kind: "union",
		};
	}

	if (schema.enum?.length) {
		const arms = schema.enum.map(literal);
		return arms.length === 1
			? atom(arms[0] ?? "unknown")
			: { text: arms.join(" | "), kind: "union" };
	}
	if (schema.const !== undefined) return atom(literal(schema.const));

	if (schema.type === "array" || schema.items) {
		const item = render(schema.items, ctx);
		const text = `${wrap(item, "array")}[]`;
		return atom(schema["x-ts-readonly"] ? `readonly ${text}` : text);
	}

	if (schema.type === "null") {
		// openpkg encodes `void` and `undefined` as `type: "null"` with the real name in `x-ts-type`.
		return atom(tsType === "void" || tsType === "undefined" ? tsType : "null");
	}

	if (schema.type === "object" || schema.properties) {
		// `Promise`, `AsyncIterableIterator`, ...: a named generic whose
		// arguments carry the substance.
		if (tsType && BARE_NAME.test(tsType)) {
			return atom(`${tsType}${typeArguments(schema, ctx)}`);
		}
		if (Object.keys(schema.properties ?? {}).length) {
			return atom(renderObjectLiteral(schema, ctx));
		}
		const extra = schema.additionalProperties;
		if (extra && typeof extra === "object") {
			return atom(`Record<string, ${render(extra, ctx).text}>`);
		}
		if (extra === true) return atom("Record<string, unknown>");
		if (tsType) return atom(tsType);
		return atom("{}");
	}

	if (tsType) {
		if (BARE_NAME.test(tsType)) {
			return atom(`${tsType}${typeArguments(schema, ctx)}`);
		}
		return /=>/.test(tsType)
			? { text: tsType, kind: "function" }
			: atom(tsType);
	}

	if (typeof schema.type === "string") {
		return atom(schema.type === "integer" ? "number" : schema.type);
	}
	if (Array.isArray(schema.type)) {
		return {
			text: schema.type
				.map((t) => (t === "integer" ? "number" : t))
				.join(" | "),
			kind: "union",
		};
	}
	return atom("unknown");
}

export function renderType(
	schema: Schema | undefined,
	ctx: RenderContext,
): string {
	return render(schema, ctx).text;
}
