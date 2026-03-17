import { tool } from "ai";
import { z } from "zod";
import { getDocsForTopic, type DocTopic } from "../docs";

const topics: [DocTopic, ...DocTopic[]] = [
  "stream-filters",
  "stream-creation",
  "api-keys",
  "subgraphs",
  "stream-management",
];

export const lookupDocs = tool({
  description:
    "Look up real product documentation. Call this BEFORE answering questions or building payloads — it returns accurate schema details, field types, and examples.",
  inputSchema: z.object({
    topic: z.enum(topics).describe("Documentation topic to retrieve"),
  }),
  execute: async ({ topic }: { topic: DocTopic }) => {
    return getDocsForTopic(topic);
  },
});
