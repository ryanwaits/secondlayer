import { CliLine } from "@/components/account/webhooks/shared";
import { CopyButton } from "@/components/copy-button";

/**
 * "Hand off to your agent": we describe what we saw in plain English, name
 * our own CLI commands, and the user's agent (which has their code) decides
 * the fix. Never render code-fix snippets here.
 */
export function HandoffBlock({
	prompt,
	commands,
}: {
	prompt: string;
	commands: readonly string[];
}) {
	return (
		<div className="ins-step">
			<div className="ins-label">Hand off to your agent</div>
			<pre className="ins-prompt">{prompt}</pre>
			{commands.map((command) => (
				<CliLine key={command} command={command} />
			))}
			<div className="ins-actions">
				<CopyButton code={prompt} label="Copy for agent" inline />
			</div>
		</div>
	);
}
