/**
 * Deploy-time lint: flag `broadcast(...)` calls lexically inside a `tool({...})`
 * body that lack cost caps or postConditions, making them AI-drainable.
 *
 * This is a belt-and-suspenders check — the real safety net is the runner
 * rejecting unbounded broadcasts at runtime. The lint catches the common
 * "copy-paste from a template" failure mode at deploy time, before the
 * workflow ever runs.
 *
 * Scope: text-based scan. Finds `tool({ ... })` blocks by matching the
 * literal token sequence. Within each, searches for `broadcast(` calls and
 * inspects their argument list for one of:
 *   - `maxMicroStx` AND `maxFee` in the broadcast options
 *   - `postConditions` in the tx builder's arg
 *   - `@sl-unsafe-broadcast` comment on the preceding line (escape hatch)
 *
 * Known limitations:
 *   - `const b = broadcast; b(...)` slips through (aliasing)
 *   - `await someHelper(...)` where the helper ultimately calls broadcast
 *   - `(broadcast)(...)` etc
 *
 * These are acceptable. Attackers who bypass the lint are the workflow
 * author (they already control code). The lint is for honest mistakes.
 */

export interface UnsafeBroadcast {
	line: number;
	toolName: string;
}

export function lintUnsafeBroadcast(source: string): UnsafeBroadcast[] {
	const results: UnsafeBroadcast[] = [];

	// Find all top-level `tool({ ... })` invocations. Greedy match on the
	// outermost `{}` isn't regex-safe, so we walk forward tracking brace depth.
	const toolStarts = findAll(source, /\btool\s*\(\s*\{/g);
	for (const start of toolStarts) {
		const openBrace = source.indexOf("{", start.index);
		const closeBrace = matchingBrace(source, openBrace);
		if (closeBrace === -1) continue;
		const body = source.slice(openBrace + 1, closeBrace);

		// Best-effort extraction of the tool's declarator (variable name / key).
		const toolName = inferToolName(source, start.index);

		// Within the tool body, find `broadcast(` calls.
		const broadcasts = findAll(body, /\bbroadcast\s*\(/g);
		for (const b of broadcasts) {
			const callOpen = body.indexOf("(", b.index);
			const callClose = matchingParen(body, callOpen);
			if (callClose === -1) continue;
			const args = body.slice(callOpen + 1, callClose);

			if (
				hasSafetyMarkers(args) ||
				hasEscapeHatch(source, openBrace + 1 + b.index)
			)
				continue;

			const lineInSource = lineNumber(source, openBrace + 1 + b.index);
			results.push({ line: lineInSource, toolName });
		}
	}

	return results;
}

// ── Helpers ───────────────────────────────────────────────────────────

function findAll(
	s: string,
	re: RegExp,
): Array<{ index: number; match: string }> {
	const out: Array<{ index: number; match: string }> = [];
	for (const m of s.matchAll(re)) {
		if (m.index != null) out.push({ index: m.index, match: m[0] });
	}
	return out;
}

function matchingBrace(s: string, openIdx: number): number {
	let depth = 0;
	let inString: '"' | "'" | "`" | null = null;
	for (let i = openIdx; i < s.length; i++) {
		const c = s[i];
		if (inString) {
			if (c === "\\") {
				i++;
				continue;
			}
			if (c === inString) inString = null;
			continue;
		}
		if (c === '"' || c === "'" || c === "`") {
			inString = c;
			continue;
		}
		if (c === "{") depth++;
		else if (c === "}") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

function matchingParen(s: string, openIdx: number): number {
	let depth = 0;
	let inString: '"' | "'" | "`" | null = null;
	for (let i = openIdx; i < s.length; i++) {
		const c = s[i];
		if (inString) {
			if (c === "\\") {
				i++;
				continue;
			}
			if (c === inString) inString = null;
			continue;
		}
		if (c === '"' || c === "'" || c === "`") {
			inString = c;
			continue;
		}
		if (c === "(") depth++;
		else if (c === ")") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

function inferToolName(source: string, toolCallStart: number): string {
	// Look backwards for a variable declaration or property name.
	const before = source.slice(Math.max(0, toolCallStart - 120), toolCallStart);
	// `const xxx = tool(` or `xxx: tool(`
	const m =
		before.match(/(?:const|let|var)\s+(\w+)\s*=\s*$/) ??
		before.match(/(\w+)\s*:\s*$/);
	return m?.[1] ?? "<anonymous>";
}

function hasSafetyMarkers(args: string): boolean {
	// `maxMicroStx` AND `maxFee` in the options literal…
	const hasMaxMicroStx = /\bmaxMicroStx\s*:/.test(args);
	const hasMaxFee = /\bmaxFee\s*:/.test(args);
	if (hasMaxMicroStx && hasMaxFee) return true;
	// …OR `postConditions` anywhere in the tx builder arg.
	if (/\bpostConditions\s*:/.test(args)) return true;
	return false;
}

function hasEscapeHatch(source: string, broadcastStart: number): boolean {
	// `// @sl-unsafe-broadcast` on the preceding source line.
	const head = source.slice(0, broadcastStart);
	const precedingLine = head.split("\n").slice(-2, -1)[0] ?? "";
	return /@sl-unsafe-broadcast\b/.test(precedingLine);
}

function lineNumber(source: string, offset: number): number {
	return source.slice(0, offset).split("\n").length;
}
