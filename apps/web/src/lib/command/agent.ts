import { anthropic } from "@ai-sdk/anthropic";
import { ToolLoopAgent, stepCountIs } from "ai";
import { answer } from "./tools/answer";
import { diagnose } from "./tools/diagnose";
import { lookupDocs } from "./tools/lookup-docs";
import { manageResource } from "./tools/manage-resource";
import { navigate } from "./tools/navigate";
import { scaffold } from "./tools/scaffold";

const tools = {
	lookup_docs: lookupDocs,
	answer,
	navigate,
	manage_resource: manageResource,
	diagnose,
	scaffold,
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
