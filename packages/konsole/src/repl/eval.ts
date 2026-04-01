// Rewrite Ruby-style hash args: where(email: "x") → where({ email: "x" })
// Only matches bare identifiers with colon: where(email: "x")
// Does NOT match: where("col", val), where({ ... }), where(obj)
export function rubyToJs(input: string): string {
	return input.replace(
		/\.(where|not|findBy)\((?!\s*\{)(\w+:\s[^)]+)\)/g,
		".$1({ $2 })",
	);
}

export async function evalExpr(
	expr: string,
	ctx: Record<string, unknown>,
): Promise<unknown> {
	const keys = Object.keys(ctx);
	const vals = Object.values(ctx);
	const asyncFn = new Function(
		...keys,
		`return (async () => { return (${expr}); })()`,
	);
	return asyncFn(...vals);
}
