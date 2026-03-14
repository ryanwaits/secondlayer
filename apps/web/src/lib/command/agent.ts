import { ToolLoopAgent, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { lookupDocs } from "./tools/lookup-docs";
import { answer } from "./tools/answer";
import { navigate } from "./tools/navigate";
import { manageResource } from "./tools/manage-resource";

const tools = {
  lookup_docs: lookupDocs,
  answer,
  navigate,
  manage_resource: manageResource,
};

export function createCommandAgent(instructions: string) {
  return new ToolLoopAgent({
    id: "command-palette",
    model: anthropic("claude-sonnet-4-20250514"),
    instructions,
    tools,
    maxOutputTokens: 2048,
    stopWhen: stepCountIs(5),
  });
}

export type CommandTools = typeof tools;
