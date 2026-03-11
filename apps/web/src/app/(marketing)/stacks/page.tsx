import { Sidebar } from "@/components/sidebar";
import { SectionHeading } from "@/components/section-heading";
import { CodeBlock } from "@/components/code-block";
import { StacksIntro } from "./stacks-intro";
import type { TocItem } from "@/components/sidebar";

const toc: TocItem[] = [
  { label: "Getting started", href: "#getting-started" },
  { label: "Clients", href: "#clients" },
  { label: "Contracts", href: "#contracts" },
  { label: "Transfers", href: "#transfers" },
  { label: "Subscriptions", href: "#subscriptions" },
  { label: "BNS", href: "#bns" },
  { label: "Props", href: "#props" },
];

export default function StacksPage() {
  return (
    <div className="article-layout">
      <Sidebar title="Stacks" toc={toc} />

      <main className="content-area">
        <header className="page-header">
          <h1 className="page-title">Stacks</h1>
          <p className="page-date">March 10, 2026</p>
        </header>

        <StacksIntro />

        <SectionHeading id="getting-started">Getting started</SectionHeading>

        <div className="prose">
          <p>
            Create a public client for read-only operations, or a wallet client
            for signing transactions. Install
            with <code>bun add @secondlayer/stacks</code>.
          </p>
        </div>

        <CodeBlock code={`import { createPublicClient, createWalletClient, http } from "@secondlayer/stacks"
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
})`} />

        <SectionHeading id="clients">Clients</SectionHeading>

        <div className="prose">
          <p>
            Three client types cover every use case.{" "}
            <code>createPublicClient</code> for reads,{" "}
            <code>createWalletClient</code> for signing, and{" "}
            <code>createMultiSigClient</code> for multi-signature transactions.
            Clients are extensible with <code>.extend()</code> for BNS, PoX,
            and StackingDAO modules.
          </p>
          <p>
            Transports are composable: <code>http()</code>,{" "}
            <code>webSocket()</code>, <code>custom()</code>, and{" "}
            <code>fallback()</code> for automatic failover.
          </p>
        </div>

        <CodeBlock code={`import { createPublicClient, http, webSocket, fallback } from "@secondlayer/stacks"
import { mainnet } from "@secondlayer/stacks/chains"

// Fallback transport — tries HTTP first, falls back to WebSocket
const publicClient = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http(),
    webSocket(),
  ]),
})

// Read-only actions
const balance = await publicClient.getBalance("SP1234...")
const height = await publicClient.getBlockHeight()
const nonce = await publicClient.getNonce("SP1234...")
const fee = await publicClient.estimateFee({ ... })`} />

        <SectionHeading id="contracts">Contracts</SectionHeading>

        <div className="prose">
          <p>
            Read and call Clarity contracts with full type safety. Method names
            are automatically converted from kebab-case to camelCase.
          </p>
        </div>

        <CodeBlock code={`import { readContract, callContract } from "@secondlayer/stacks/actions"

// Read-only call
const balance = await readContract(publicClient, {
  contract: "SP2C2YFP12AJZB1MAERTSVAR6NQJHQ5MEH0GH33C.usda-token",
  method: "getBalance",   // auto-camelCased from get-balance
  args: { owner: "SP1234..." },
})

// State-changing call
const txId = await callContract(wallet, {
  contract: "SP2C2YFP12AJZB1MAERTSVAR6NQJHQ5MEH0GH33C.usda-token",
  method: "transfer",
  args: { amount: 1000n, sender: "SP1234...", recipient: "SP5678..." },
})

// Simulate without broadcasting
const result = await simulateCall(publicClient, {
  contract: "SP2C2YFP12AJZB1MAERTSVAR6NQJHQ5MEH0GH33C.usda-token",
  method: "getBalance",
  args: { owner: "SP1234..." },
})

// Batch multiple reads in a single call
const results = await multicall(publicClient, [
  { contract: "SP...::token-a", method: "getBalance", args: { owner: "SP..." } },
  { contract: "SP...::token-b", method: "getBalance", args: { owner: "SP..." } },
])`} />

        <SectionHeading id="transfers">Transfers</SectionHeading>

        <div className="prose">
          <p>
            STX transfers with post-conditions for safety.
          </p>
        </div>

        <CodeBlock code={`import { transferStx } from "@secondlayer/stacks/actions"
import { Pc } from "@secondlayer/stacks/postconditions"

const txId = await transferStx(wallet, {
  recipient: "SP5678...",
  amount: 1_000_000n, // 1 STX in microSTX
  memo: "payment",
  postConditions: [
    Pc.principal("SP1234...").willSendLte(1_000_000n).ustx(),
  ],
})`} />

        <SectionHeading id="subscriptions">Subscriptions</SectionHeading>

        <div className="prose">
          <p>
            Subscribe to real-time blockchain events over WebSocket.
          </p>
        </div>

        <CodeBlock code={`import { watchBlocks, watchMempool, watchTransaction,
  watchAddress, watchAddressBalance } from "@secondlayer/stacks/subscriptions"

const unwatch = watchBlocks(publicClient, {
  onBlock: (block) => console.log("New block:", block.height),
})

const unwatchMempool = watchMempool(publicClient, {
  onTransaction: (tx) => console.log("Pending:", tx.txId),
})

// Watch a specific transaction until confirmed
watchTransaction(publicClient, {
  txId: "0x...",
  onStatusChange: (status) => console.log("Status:", status),
})

// Watch an address for activity
watchAddress(publicClient, {
  address: "SP1234...",
  onTransaction: (tx) => console.log("Activity:", tx),
})`} />

        <SectionHeading id="bns">BNS</SectionHeading>

        <div className="prose">
          <p>
            Bitcoin Name System — register and resolve <code>.btc</code> names.
          </p>
        </div>

        <CodeBlock code={`import { resolveName, registerName } from "@secondlayer/stacks/bns"

const address = await resolveName(publicClient, { name: "alice.btc" })

const txId = await registerName(wallet, {
  name: "myname",
  namespace: "btc",
  zonefile: "...",
})`} />

        <SectionHeading id="props">Props</SectionHeading>

        <div className="props-section">
          <div className="props-group-title">Clients</div>

          <div className="prop-row">
            <span className="prop-name">chain</span>
            <span className="prop-type">Chain</span>
            <span className="prop-required">required</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">transport</span>
            <span className="prop-type">Transport</span>
            <span className="prop-required">required</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">account</span>
            <span className="prop-type">Account</span>
            <span className="prop-default">wallet client only</span>
          </div>

          <div className="props-group-title">Chains</div>

          <div className="prop-row">
            <span className="prop-name">mainnet</span>
            <span className="prop-type">Chain</span>
            <span className="prop-default">chain ID 0x00000001</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">testnet</span>
            <span className="prop-type">Chain</span>
            <span className="prop-default">chain ID 0x80000000</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">devnet</span>
            <span className="prop-type">Chain</span>
            <span className="prop-default">localhost:3999</span>
          </div>

          <div className="props-group-title">Accounts</div>

          <div className="prop-row">
            <span className="prop-name">privateKeyToAccount</span>
            <span className="prop-type">(key: string) → Account</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">mnemonicToAccount</span>
            <span className="prop-type">(mnemonic: string) → Account</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">providerToAccount</span>
            <span className="prop-type">(provider) → Account</span>
          </div>

          <div className="props-group-title">Transports</div>

          <div className="prop-row">
            <span className="prop-name">http</span>
            <span className="prop-type">(url?) → Transport</span>
            <span className="prop-default">chain RPC</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">webSocket</span>
            <span className="prop-type">(url?) → Transport</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">fallback</span>
            <span className="prop-type">(transports[]) → Transport</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">custom</span>
            <span className="prop-type">(handler) → Transport</span>
          </div>

          <div className="props-group-title">Modules</div>

          <div className="prop-row">
            <span className="prop-name">actions</span>
            <span className="prop-type">readContract, callContract, transferStx, deployContract, multicall, simulateCall, getContract, getMapEntry, getContractAbi, getBalance, getBlockHeight, getBlock, getNonce, estimateFee, getAccountInfo</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">transactions</span>
            <span className="prop-type">buildTokenTransfer, buildContractCall, buildContractDeploy, signTransaction, signMessage, sponsorTransaction</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">subscriptions</span>
            <span className="prop-type">watchBlocks, watchMempool, watchTransaction, watchAddress, watchAddressBalance, watchNftEvent</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">postconditions</span>
            <span className="prop-type">Pc fluent builder for post-conditions</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">clarity</span>
            <span className="prop-type">Cl constructors, serialize/deserialize, ABI types</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">bns</span>
            <span className="prop-type">resolveName, registerName</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">pox</span>
            <span className="prop-type">stackStx, delegateStx</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">stackingdao</span>
            <span className="prop-type">StackingDAO liquid staking</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">connect</span>
            <span className="prop-type">Wallet connection, WalletConnect v2</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">utils</span>
            <span className="prop-type">formatStx, parseStx, address validation, encoding</span>
          </div>
        </div>
      </main>
    </div>
  );
}
