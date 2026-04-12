import { highlight, normalizeLang } from "@/lib/highlight";
import { tool } from "ai";
import { z } from "zod";

// Reject obvious placeholder tokens — forces the model to substitute
// real resource names instead of emitting {table-name} / your-api-key.
// Allowed: real values like sk-sl_7b3719eb, contracts-registry, etc.
const PLACEHOLDER_PATTERNS: Array<{ re: RegExp; label: string }> = [
	{ re: /\{[a-z][a-z0-9_-]*\}/i, label: "{placeholder}" },
	{ re: /\byour[-_][a-z0-9_-]+\b/i, label: "your-*" },
	{ re: /\bYOUR_[A-Z0-9_]+\b/, label: "YOUR_*" },
	{ re: /<[a-z][a-z0-9_-]*>/i, label: "<placeholder>" },
];

function findPlaceholder(code: string): string | null {
	for (const { re, label } of PLACEHOLDER_PATTERNS) {
		if (re.test(code)) return label;
	}
	return null;
}

export const showCode = tool({
	description:
		"Display a tabbed code example card to the user. Use for multi-language examples with tabs: curl, Node.js, SDK (@secondlayer/sdk). Do NOT include Python. Each tab gets syntax highlighting and a copy button. CRITICAL: every tab's code must use concrete resource values from the user's account (real subgraph name, real table name, real API key prefix). Never emit placeholder tokens like {table-name}, your-api-key, or <id> — the tool will reject them.",
	inputSchema: z.object({
		tabs: z
			.array(
				z.object({
					label: z
						.string()
						.describe("Tab label (e.g. 'curl', 'Node.js', 'SDK')"),
					lang: z
						.string()
						.describe("Language: bash, javascript, typescript, json, sql"),
					code: z.string().describe("Code content with real resource values"),
				}),
			)
			.describe("Array of code tabs to display"),
	}),
	execute: async ({ tabs }) => {
		for (const t of tabs) {
			const hit = findPlaceholder(t.code);
			if (hit) {
				return {
					error: true,
					message: `Tab "${t.label}" contains placeholder token (${hit}). Rewrite using concrete values from the user's resources — real subgraph name, real table name, real API key prefix. Do not use {braces}, <angles>, or your-* / YOUR_* tokens.`,
				};
			}
		}

		const rendered = await Promise.all(
			tabs.map(async (t) => {
				const lang = normalizeLang(t.lang);
				const html = await highlight(t.code, lang);
				return { label: t.label, lang, code: t.code, html };
			}),
		);

		return { tabs: rendered };
	},
});
