/**
 * Homepage quickstart — the three steps under the hero, driven by the agent.
 *
 * Commands here are real CLI surface (see packages/cli/src/commands and
 * skills/secondlayer). If a flag or contract id changes, change it here too.
 */

export type HarnessKey = "claude" | "codex" | "cursor";

export interface Harness {
	key: HarnessKey;
	label: string;
	/** One line under the step title, swapped with the picker. */
	blurb: string;
	/** Window title-bar text. */
	file: string;
	lang: "bash" | "json";
	code: string;
}

const MCP_ENV = {
	SL_API_URL: "http://127.0.0.1:3800",
	INSTANCE_TOKEN: "<from secondlayer init>",
};

export const HARNESSES: Harness[] = [
	{
		key: "claude",
		label: "Claude Code",
		blurb: "One script. Picked up on the next session.",
		file: "terminal",
		lang: "bash",
		code: "curl -fsSL https://secondlayer.tools/skill.sh | bash",
	},
	{
		key: "codex",
		label: "Codex",
		blurb:
			"Codex takes the MCP server instead; the tools are the same surface.",
		file: "terminal",
		lang: "bash",
		code: `codex mcp add secondlayer --env SL_API_URL=${MCP_ENV.SL_API_URL} --env INSTANCE_TOKEN=$INSTANCE_TOKEN -- bunx @secondlayer/mcp`,
	},
	{
		key: "cursor",
		label: "Cursor",
		blurb:
			"Cursor, or any MCP client, reads the same server from a config file.",
		file: ".cursor/mcp.json",
		lang: "json",
		code: JSON.stringify(
			{
				mcpServers: {
					secondlayer: {
						command: "bunx",
						args: ["@secondlayer/mcp"],
						env: MCP_ENV,
					},
				},
			},
			null,
			2,
		),
	},
];

export const TABLE_STEP =
	"/secondlayer index sBTC deposits and withdrawals into a table called sbtc-flows";

export const READ_CMD =
	"curl http://127.0.0.1:3800/v1/subgraphs/sbtc-flows?limit=3";
