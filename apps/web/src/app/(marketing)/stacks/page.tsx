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
	{ label: "For agents", href: "#for-agents" },
	{ label: "Tools", href: "#tools" },
	{ label: "Bitcoin tools", href: "#btc-tools" },
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
						Read and call Clarity contracts. Arguments are{" "}
						<code>ClarityValue[]</code> — build them with <code>Cl.*</code>{" "}
						helpers from <code>@secondlayer/stacks/clarity</code>.
					</p>
				</div>

				<CodeBlock
					code={`import { readContract, callContract, multicall } from "@secondlayer/stacks/actions"
import { Cl } from "@secondlayer/stacks/clarity"

const balance = await readContract(publicClient, {
  contract: "SP2C2YFP12AJZB1MAERTSVAR6NQJHQ5MEH0GH33C.usda-token",
  functionName: "get-balance",
  args: [Cl.standardPrincipal("SP1234...")],
})

const txId = await callContract(wallet, {
  contract: "SP2C2YFP12AJZB1MAERTSVAR6NQJHQ5MEH0GH33C.usda-token",
  functionName: "transfer",
  functionArgs: [
    Cl.uint(1000n),
    Cl.standardPrincipal("SP1234..."),
    Cl.standardPrincipal("SP5678..."),
    Cl.none(),
  ],
})

// Batch multiple reads in one call
const results = await multicall(publicClient, {
  calls: [
    { contract: "SP...::token-a", functionName: "get-balance", args: [Cl.standardPrincipal("SP...")] },
    { contract: "SP...::token-b", functionName: "get-balance", args: [Cl.standardPrincipal("SP...")] },
  ],
})`}
				/>

				<SectionHeading id="transfers">Transfers</SectionHeading>

				<CodeBlock
					code={`import { transferStx } from "@secondlayer/stacks/actions"
import { Pc } from "@secondlayer/stacks/postconditions"

const txId = await transferStx(wallet, {
  to: "SP5678...",
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
					code={`import { bns } from "@secondlayer/stacks/bns"

// Extend a client with the BNS namespace.
const client = publicClient.extend(bns())

const address = await client.bns.resolveName("alice.btc")
const primary = await client.bns.getPrimaryName("SP1234...")

// Registration is a two-step preorder → register (signed, 10+ block gap).
// Use claimFast for uncontested namespaces (single tx, no commit-reveal).
const walletWithBns = wallet.extend(bns())
const txId = await walletWithBns.bns.claimFast({
  name: "myname",
  namespace: "btc",
  sendTo: "SP1234...",
})`}
				/>

				<SectionHeading id="for-agents">For agents</SectionHeading>

				<div className="prose">
					<p>
						Subpaths built for agents: AI-SDK tools for Stacks reads and
						Bitcoin-side lookups. Pass them straight to any model call.
					</p>
				</div>

				<SectionHeading id="tools">Tools</SectionHeading>

				<div className="prose">
					<p>
						Twelve read-only tools compatible with AI SDK v6. Pass them straight
						to <code>generateText</code> so models can query balances,
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

const { text } = await generateText({
  model: anthropic("claude-sonnet-4-6"),
  tools: { getStxBalance, readContract, bnsResolve },
  prompt: "What's alice.btc's STX balance and recent activity?",
})`}
				/>

				<SectionHeading id="btc-tools">Bitcoin tools</SectionHeading>

				<div className="prose">
					<p>
						Five Bitcoin-side reads for sBTC flows and confirmation tracking.
						Same AI-SDK shape — drop into any <code>generateText</code> call.
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
			</main>
		</div>
	);
}
