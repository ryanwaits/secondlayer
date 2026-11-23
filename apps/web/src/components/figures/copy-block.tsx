"use client";

import { AgentPromptBlock } from "@/components/agent-prompt";

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
