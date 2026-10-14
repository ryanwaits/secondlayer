/**
 * Source-text lookups for facts openpkg does not carry per member: the line a
 * member is declared on, and the REST endpoint a client method calls.
 */

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Character offset of `name`'s declaration at or after `from`. Matches class
 * members, interface/type members and object-literal keys.
 */
function findDeclaration(
	text: string,
	from: number,
	name: string,
): number | null {
	const pattern = new RegExp(
		`^[ \\t]*(?:(?:public|private|protected|override|readonly|static|async)\\s+)*\\*?${escapeRegExp(name)}\\s*\\??\\s*(?:[(<:=]|$)`,
		"gm",
	);
	pattern.lastIndex = from;
	const match = pattern.exec(text);
	return match ? match.index : null;
}

function offsetOfLine(text: string, line: number): number {
	let offset = 0;
	for (let i = 1; i < line; i++) {
		const next = text.indexOf("\n", offset);
		if (next === -1) return offset;
		offset = next + 1;
	}
	return offset;
}

function lineOfOffset(text: string, offset: number): number {
	let line = 1;
	for (let i = text.indexOf("\n"); i !== -1 && i < offset; ) {
		line++;
		i = text.indexOf("\n", i + 1);
	}
	return line;
}

/** Walk `path` one segment at a time from `startLine`; null when any step is missing. */
export function locate(
	text: string,
	startLine: number,
	path: string[],
): { offset: number; line: number } | null {
	let offset = offsetOfLine(text, startLine);
	for (const segment of path) {
		const found = findDeclaration(text, offset, segment);
		if (found === null) return null;
		// Resume after the matched name so the next segment is looked up inside it.
		offset = found + 1;
	}
	return { offset, line: lineOfOffset(text, offset) };
}

/** Index just past the `close` that balances the `open` at `start`. */
function balanced(
	text: string,
	start: number,
	open: string,
	close: string,
): number | null {
	let depth = 0;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (ch === open) depth++;
		else if (ch === close && --depth === 0) return i + 1;
	}
	return null;
}

/** Body text of the class method declared at `offset`, or null for non-block members. */
function methodBody(text: string, offset: number): string | null {
	const paren = text.indexOf("(", offset);
	if (paren === -1) return null;
	const afterParams = balanced(text, paren, "(", ")");
	if (afterParams === null) return null;
	// Skip the return type; a block body starts at the next `{` before any `;`/`=>`.
	let i = afterParams;
	let angle = 0;
	for (; i < text.length; i++) {
		const ch = text[i];
		if (ch === "<") angle++;
		else if (ch === ">" && text[i - 1] !== "=") angle--;
		else if (ch === ";" && angle <= 0) return null;
		else if (ch === "=" && text[i + 1] === ">") return null;
		else if (ch === "{") {
			// A `{` inside generics or right after `:`/`|`/`&` is a type literal
			// in the return type; the body is the first `{` that is neither.
			const literal = angle > 0 || /[:|&]\s*$/.test(text.slice(0, i));
			const end = balanced(text, i, "{", "}");
			if (end === null) return null;
			if (!literal) return text.slice(i, end);
			i = end - 1;
		}
	}
	return null;
}

/** Turn a template-literal request path into `/a/{id}`; null when not simple. */
function normalizePath(raw: string): string | null {
	let out = "";
	for (let i = 0; i < raw.length; i++) {
		if (raw[i] === "$" && raw[i + 1] === "{") {
			const end = balanced(raw, i + 1, "{", "}");
			if (end === null) return null;
			const expr = raw.slice(i + 2, end - 1).trim();
			i = end - 1;
			// Query-string builders trail the path; they are not part of it.
			if (/^(buildQuery|qs|query|search)/i.test(expr)) continue;
			const name = expr.match(/^(?:[A-Za-z_$][\w$]*\()*([A-Za-z_$][\w$]*)\)*$/);
			if (!name?.[1]) return null;
			out += `{${name[1]}}`;
			continue;
		}
		out += raw[i];
	}
	return out;
}

const REQUEST =
	/\brequest(?:OrNull|Text)?\s*(?:<[\s\S]*?>)?\s*\(\s*"(GET|POST|PUT|PATCH|DELETE)"\s*,\s*(["'`])((?:(?!\2)[\s\S])*?)\2/;

/**
 * `GET /v1/streams/events` for a class method whose request path is a literal
 * in its own body. Anything indirect (a helper that builds the path) is
 * skipped rather than guessed.
 */
export function restFor(
	text: string,
	startLine: number,
	path: string[],
): string | null {
	const at = locate(text, startLine, path);
	if (!at) return null;
	const declaration = text.lastIndexOf("\n", at.offset - 1) + 1;
	const body = methodBody(text, declaration);
	if (!body) return null;
	const match = REQUEST.exec(body);
	if (!match) return null;
	const [, verb, , rawPath] = match;
	if (!verb || rawPath === undefined) return null;
	const normalized = normalizePath(rawPath);
	return normalized?.startsWith("/") ? `${verb} ${normalized}` : null;
}

/**
 * True when the class declared at `startLine` has a private or protected
 * constructor (a `static` factory is its way in). openpkg lists the
 * constructor's signature either way.
 */
export function hasHiddenConstructor(text: string, startLine: number): boolean {
	const from = offsetOfLine(text, startLine);
	const open = text.indexOf("{", from);
	if (open === -1) return false;
	const end = balanced(text, open, "{", "}");
	const body = text.slice(open, end ?? text.length);
	const match = /^[ \t]*(?:(private|protected)\s+)?constructor\s*\(/m.exec(
		body,
	);
	return match?.[1] !== undefined;
}
