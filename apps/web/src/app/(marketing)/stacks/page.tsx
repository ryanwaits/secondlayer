import { CodeBlock } from "@/components/code-block";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import { StacksIntro } from "./stacks-intro";

const toc: TocItem[] = [
	{ label: "Getting started", href: "#getting-started" },
	{ label: "Clients", href: "#clients" },
	{ label: "Contracts", href: "#contracts" },
	{ label: "Transfers", href: "#transfers" },
	{ label: "Subscriptions", href: "#subscriptions" },
	{ label: "BNS", href: "#bns" },
	{ label: "In workflows", href: "#in-workflows" },
	{ label: "Tools", href: "#tools" },
	{ label: "Bitcoin tools", href: "#btc-tools" },
	{ label: "Triggers", href: "#triggers" },
	{ label: "Tx intents", href: "#tx" },
	{ label: "UI schemas", href: "#ui-schemas" },
	{ label: "UI atoms", href: "#ui" },
];

export default function StacksPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Stacks" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">Stacks</h1>
				</header>

				<StacksIntro />

				<SectionHeading id="getting-started">Getting started</SectionHeading>

				<div className="prose">
					<p>
						Create a public client for read-only operations, or a wallet client
						for signing transactions. Install with{" "}
						<code>bun add @secondlayer/stacks</code>.
					</p>
				</div>

				<CodeBlock
					code={`import { createPublicClient, createWalletClient, http } from "@secondlayer/stacks"
import { mainnet } from "@secondlayer/stacks/chains"
import { privateKeyToAccount } from "@secondlayer/stacks/accounts"

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(),
})

const wallet = createWalletClient({
  chain: mainnet,
  transport: http(),
  account: privateKeyToAccount("..."),
})`}
				/>

				<SectionHeading id="clients">Clients</SectionHeading>

				<div className="prose">
					<p>
						Transports are composable: <code>http()</code>,{" "}
						<code>webSocket()</code>, and <code>fallback()</code> for automatic
						failover.
					</p>
				</div>

				<CodeBlock
					code={`import { createPublicClient, fallback, http, webSocket } from "@secondlayer/stacks"
import { mainnet } from "@secondlayer/stacks/chains"

const publicClient = createPublicClient({
  chain: mainnet,
  transport: fallback([http(), webSocket()]),
})

const balance = await publicClient.getBalance("SP1234...")
const height = await publicClient.getBlockHeight()
const nonce = await publicClient.getNonce("SP1234...")`}
				/>

				<SectionHeading id="contracts">Contracts</SectionHeading>

				<div className="prose">
					<p>
						Read and call Clarity contracts with full type safety. Method names
						are automatically converted from kebab-case to camelCase.
					</p>
				</div>

				<CodeBlock
					code={`import { readContract, callContract, multicall } from "@secondlayer/stacks/actions"

const balance = await readContract(publicClient, {
  contract: "SP2C2YFP12AJZB1MAERTSVAR6NQJHQ5MEH0GH33C.usda-token",
  method: "getBalance",
  args: { owner: "SP1234..." },
})

const txId = await callContract(wallet, {
  contract: "SP2C2YFP12AJZB1MAERTSVAR6NQJHQ5MEH0GH33C.usda-token",
  method: "transfer",
  args: { amount: 1000n, sender: "SP1234...", recipient: "SP5678..." },
})

// Batch multiple reads in one call
const results = await multicall(publicClient, [
  { contract: "SP...::token-a", method: "getBalance", args: { owner: "SP..." } },
  { contract: "SP...::token-b", method: "getBalance", args: { owner: "SP..." } },
])`}
				/>

				<SectionHeading id="transfers">Transfers</SectionHeading>

				<CodeBlock
					code={`import { transferStx } from "@secondlayer/stacks/actions"
import { Pc } from "@secondlayer/stacks/postconditions"

const txId = await transferStx(wallet, {
  recipient: "SP5678...",
  amount: 1_000_000n, // 1 STX in microSTX
  memo: "payment",
  postConditions: [
    Pc.principal("SP1234...").willSendLte(1_000_000n).ustx(),
  ],
})`}
				/>

				<SectionHeading id="subscriptions">Subscriptions</SectionHeading>

				<div className="prose">
					<p>Subscribe to real-time blockchain events over WebSocket.</p>
				</div>

				<CodeBlock
					code={`import { watchBlocks, watchMempool, watchTransaction } from "@secondlayer/stacks/subscriptions"

const unwatch = watchBlocks(publicClient, {
  onBlock: (block) => console.log("New block:", block.height),
})

watchTransaction(publicClient, {
  txId: "0x...",
  onStatusChange: (status) => console.log("Status:", status),
})`}
				/>

				<SectionHeading id="bns">BNS</SectionHeading>

				<div className="prose">
					<p>
						Bitcoin Name System — register and resolve <code>.btc</code> names.
					</p>
				</div>

				<CodeBlock
					code={`import { resolveName, registerName } from "@secondlayer/stacks/bns"

const address = await resolveName(publicClient, { name: "alice.btc" })

const txId = await registerName(wallet, {
  name: "myname",
  namespace: "btc",
  zonefile: "...",
})`}
				/>

				<SectionHeading id="in-workflows">In workflows</SectionHeading>

				<div className="prose">
					<p>
						Subpaths built for workflows: AI-SDK tools, typed event triggers,
						unsigned tx intents for <code>broadcast()</code>, and React-free
						schemas plus atoms for dashboard rendering.
					</p>
				</div>

				<SectionHeading id="tools">Tools</SectionHeading>

				<div className="prose">
					<p>
						Twelve read-only tools compatible with AI SDK v6. Pass them straight
						to <code>step.generateText</code> so models can query balances,
						contracts, transactions, and BNS on their own.
					</p>
				</div>

				<CodeBlock
					code={`import {
  getStxBalance,
  getAccountInfo,
  readContract,
  bnsReverse,
  bnsResolve,
  getTransaction,
  getAccountHistory,
} from "@secondlayer/stacks/tools"

const { text } = await step.generateText("analyze", {
  model: anthropic("claude-sonnet-4-6"),
  tools: { getStxBalance, readContract, bnsResolve },
  prompt: "What's alice.btc's STX balance and recent activity?",
})`}
				/>

				<SectionHeading id="btc-tools">Bitcoin tools</SectionHeading>

				<div className="prose">
					<p>
						Five Bitcoin-side reads for sBTC flows and confirmation tracking.
						Same AI-SDK shape — drop into any <code>step.generateText</code>{" "}
						call.
					</p>
				</div>

				<CodeBlock
					code={`import {
  btcConfirmations,
  btcBalance,
  btcUtxos,
  btcFeeEstimate,
  btcBlockHeight,
} from "@secondlayer/stacks/tools/btc"`}
				/>

				<SectionHeading id="triggers">Triggers</SectionHeading>

				<div className="prose">
					<p>
						Typed <code>on.*</code> helpers for workflow event filters. Each
						returns a narrowed event type so the handler gets exact fields for
						the match.
					</p>
				</div>

				<CodeBlock
					code={`import { on } from "@secondlayer/stacks/triggers"

export default defineWorkflow({
  name: "big-transfers",
  trigger: on.stxTransfer({ minAmount: 100_000_000_000n }),
  handler: async ({ event, step }) => {
    // event is typed: { sender, recipient, amount, memo, ... }
  },
})

// Other helpers
on.contractCall({ contract: "SP...::pool", method: "swap" })
on.nftMint({ asset: "SP...::collection" })`}
				/>

				<SectionHeading id="tx">Tx intents</SectionHeading>

				<div className="prose">
					<p>
						Unsigned transaction intents — plain objects consumed by workflow{" "}
						<code>broadcast()</code> (or signed manually). No keys in the
						workflow; signing happens at the edge.
					</p>
				</div>

				<CodeBlock
					code={`import { tx } from "@secondlayer/stacks/tx"

const intent = tx.transfer({
  recipient: "SP5678...",
  amount: 1_000_000n,
  memo: "payout",
})

await step.broadcast("send", intent)

// Also: tx.contractCall, tx.deploy, tx.multisend`}
				/>

				<SectionHeading id="ui-schemas">UI schemas</SectionHeading>

				<div className="prose">
					<p>
						React-free Zod schemas describing renderable values — addresses,
						amounts, tx statuses, BNS names. Workflows return these in
						json-render catalogs; the dashboard resolves them to atoms.
					</p>
				</div>

				<CodeBlock
					code={`import { address, amount, txStatus } from "@secondlayer/stacks/ui/schemas"

return {
  from: address("SP1234..."),
  value: amount(1_000_000n, { token: "STX" }),
  status: txStatus("0xabc..."),
}`}
				/>

				<SectionHeading id="ui">UI atoms</SectionHeading>

				<div className="prose">
					<p>
						React components that render the schemas above: <code>Address</code>
						, <code>Amount</code>, <code>TxStatus</code>, <code>Principal</code>
						, <code>BnsName</code>, <code>NftAsset</code>,{" "}
						<code>BlockHeight</code>, <code>Token</code>. Used by the dashboard
						runtime and available for custom views.
					</p>
				</div>

				<CodeBlock
					code={`import { Address, Amount, TxStatus } from "@secondlayer/stacks/ui"

<Address value="SP1234..." />
<Amount value={1_000_000n} token="STX" />
<TxStatus txId="0xabc..." />`}
				/>
			</main>
		</div>
	);
}
