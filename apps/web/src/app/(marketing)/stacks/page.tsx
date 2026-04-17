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
			</main>
		</div>
	);
}
