import {
	CLAUDE_CODE_MCP_COMMAND,
	SKILL_INSTALL_COMMAND,
} from "@/lib/agent-prompts";
import { CliLine } from "../webhooks/shared";

export const CLI_LOGIN_COMMAND = "npx @secondlayer/cli login";

/** The three ways to work from a terminal, one copy row each. */
export function TerminalBlock() {
	return (
		<section className="ov-section" aria-label="Work from your terminal">
			<div className="ov-section-h">
				<h2>Work from your terminal</h2>
			</div>
			<CliLine label="CLI" command={CLI_LOGIN_COMMAND} />
			<CliLine label="Claude Code" command={CLAUDE_CODE_MCP_COMMAND} />
			<CliLine label="Skill" command={SKILL_INSTALL_COMMAND} />
		</section>
	);
}
