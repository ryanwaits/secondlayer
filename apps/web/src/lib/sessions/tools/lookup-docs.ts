import { tool } from "ai";
import { z } from "zod";
import { type DocTopic, getDocsForTopic } from "@/lib/command/docs";

const topics: [DocTopic, ...DocTopic[]] = [
	"stream-filters",
	"stream-creation",
	"api-keys",
	"subgraphs",
	"stream-management",
	"subgraph-scaffold",
];

export const lookupDocs = tool({
	description:
		"Look up real product documentation. Call this BEFORE answering product questions — it returns accurate schema details, field types, and examples.",
	inputSchema: z.object({
		topic: z.enum(topics).describe("Documentation topic to retrieve"),
	}),
	execute: async ({ topic }: { topic: DocTopic }) => {
		return getDocsForTopic(topic);
	},
});
