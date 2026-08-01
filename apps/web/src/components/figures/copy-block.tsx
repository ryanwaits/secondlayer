"use client";

import { AgentPromptBlock } from "@/components/console/agent-prompt";

/**
 * D7 CopyBlock — ADOPTS the production agent-prompt block (one
 * implementation, two mounts; never forked). A copyable
 * hand-to-your-agent block with the collapse mask for long prompts.
 */
export function CopyBlock({
	title,
	code,
	lang = "markdown",
}: {
	title?: string;
	code: string;
	lang?: string;
}) {
	return <AgentPromptBlock title={title} code={code} lang={lang} />;
}
