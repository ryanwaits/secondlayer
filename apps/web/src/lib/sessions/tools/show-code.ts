import { tool } from "ai";
import { z } from "zod";

export const showCode = tool({
	description:
		"Display a tabbed code example card to the user. Use this for multi-language examples with tabs: curl, Node.js, and SDK (@secondlayer/sdk). Do NOT include Python. Each tab gets syntax highlighting and a copy button.",
	inputSchema: z.object({
		tabs: z
			.array(
				z.object({
					label: z.string().describe("Tab label (e.g. 'curl', 'JavaScript')"),
					lang: z
						.string()
						.describe(
							"Language for syntax highlighting (bash, javascript, typescript, python, json, sql)",
						),
					code: z.string().describe("Code content for this tab"),
				}),
			)
			.describe("Array of code tabs to display"),
	}),
	execute: async ({ tabs }) => ({ tabs }),
});
