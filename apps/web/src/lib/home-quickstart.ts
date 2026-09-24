/**
 * Homepage quickstart — the three steps under the hero, driven by the agent,
 * against the hosted API. The self-host path is the section below it.
 *
 * Commands here are real CLI/MCP/API surface (see packages/mcp/src/lib/client.ts
 * and /v1/index/pox5/events). If an env var or endpoint changes, change it here.
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

const HOSTED_API = "https://api.secondlayer.tools";

/** MCP against the hosted API: the account key, not an instance token. */
const MCP_ENV = {
	SL_API_URL: HOSTED_API,
	SECONDLAYER_API_KEY: "<sk-sl_ key from /account/keys>",
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
		code: `codex mcp add secondlayer --env SL_API_URL=${HOSTED_API} --env SECONDLAYER_API_KEY=$SECONDLAYER_API_KEY -- bunx @secondlayer/mcp`,
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

export const ASK_STEP =
	"/secondlayer show who staked into PoX-5 today, grouped by signer";

export const READ_CMD = `curl -H "Authorization: Bearer $SECONDLAYER_API_KEY" \\
  "${HOSTED_API}/v1/index/pox5/events?topic=stake&limit=3"`;
