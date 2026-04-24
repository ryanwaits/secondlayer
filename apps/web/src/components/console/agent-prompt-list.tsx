import { AgentPromptBlock } from "./agent-prompt";

interface PromptBlock {
	title: string;
	code: string;
}

export function AgentPromptList({ prompts }: { prompts: PromptBlock[] }) {
	return (
		<div className="agent-prompt-list">
			{prompts.map((prompt) => (
				<AgentPromptBlock
					key={prompt.title}
					title={prompt.title}
					code={prompt.code}
					collapsible
				/>
			))}
		</div>
	);
}
