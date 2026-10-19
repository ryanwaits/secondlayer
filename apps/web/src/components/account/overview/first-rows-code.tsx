import { Code } from "@/components/code/code";
import { CodeTabs } from "@/components/code/code-tabs";
import { FIRST_ROWS_PROMPT } from "@/lib/onboarding";

const SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

const CLI = `# Once, if you haven't: save the key for every sl command
pbpaste | sl login --with-token
sl index ft-transfers --contract-id ${SBTC} --order desc --limit 5`;

const SDK = `import { SecondLayer } from "@secondlayer/sdk";

// !mark[/SECONDLAYER_API_KEY/]
const sl = new SecondLayer({ apiKey: process.env.SECONDLAYER_API_KEY });

const { events } = await sl.index.ftTransfers.list({
  // !mark[/contractId/]
  contractId: "${SBTC}",
  order: "desc",
  limit: 5,
});

for (const t of events) console.log(t.sender, t.recipient, t.amount);`;

const HTTP = `curl "https://api.secondlayer.tools/v1/index/ft-transfers?contract_id=${SBTC}&order=desc&limit=5" \\
  -H "Authorization: Bearer $SECONDLAYER_API_KEY"`;

/**
 * The first-rows guide's server-rendered blocks: one read three ways, and the
 * prompt. `nokey`: the reader just made their own key, so no docs-key slot.
 */
export function FirstRowsCode() {
	return (
		<CodeTabs sync="first-rows">
			<Code lang="bash" title="CLI" meta="nokey" code={CLI} />
			<Code lang="ts" title="SDK" meta="nokey" code={SDK} />
			<Code lang="bash" title="HTTP" meta="nokey" code={HTTP} />
		</CodeTabs>
	);
}

export function FirstRowsPrompt() {
	return (
		<Code lang="markdown" meta="nokey nocopy wrap" code={FIRST_ROWS_PROMPT} />
	);
}
