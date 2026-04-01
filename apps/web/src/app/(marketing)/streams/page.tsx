import { BoxBadge } from "@/components/box-badge";
import { CodeBlock } from "@/components/code-block";
import { AgentPromptBlock } from "@/components/console/agent-prompt";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import { MARKETING_STREAMS_PROMPT } from "@/lib/agent-prompts";

const toc: TocItem[] = [
	{ label: "Getting started", href: "#getting-started" },
	{ label: "Filters", href: "#filters" },
	{ label: "Delivery payload", href: "#delivery-payload" },
	{ label: "Management", href: "#management" },
	{ label: "Replay", href: "#replay" },
	{ label: "CLI", href: "#cli" },
	{ label: "Props", href: "#props" },
];

export default function StreamsPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Streams" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">
						Streams <BoxBadge>Beta</BoxBadge>
					</h1>
				</header>

				<div className="prose">
					<p>
						Streams deliver onchain events to your app in real-time. Define
						filters for the activity you care about — transfers, contract calls,
						deployments, token events — and secondlayer pushes matching events
						to your endpoint as each block is processed.
					</p>
					<p>Delivery is at-least-once. Handlers should be idempotent.</p>
				</div>

				<AgentPromptBlock
					title="Set up streams with your agent."
					code={MARKETING_STREAMS_PROMPT}
					collapsible
				/>

				<SectionHeading id="getting-started">Getting started</SectionHeading>

				<div className="prose">
					<p>
						Create a stream via the SDK. You&apos;ll get back a signing secret
						for verifying deliveries.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`import { SecondLayer } from "@secondlayer/sdk"

const client = new SecondLayer({ apiKey: "sk-sl_..." })

const { stream, signingSecret } = await client.streams.create({
  name: "my-stream",
  endpointUrl: "https://example.com/streams",
  filters: [
    { type: "stx_transfer" },
  ],
})`}
				/>

				<SectionHeading id="filters">Filters</SectionHeading>

				<div className="prose">
					<p>
						Each stream takes an array of filters. A block matches if any filter
						matches. Filters narrow by type and optional fields like contract,
						sender, recipient, or amount.
					</p>
				</div>

				<CodeBlock
					code={`filters: [
  // STX transfers over 1 STX
  { type: "stx_transfer", minAmount: 1_000_000 },

  // Calls to a specific contract function
  {
    type: "contract_call",
    contractId: "SP1234...::marketplace",
    functionName: "list-asset",
  },

  // NFT mints from a specific collection
  {
    type: "nft_mint",
    assetIdentifier: "SP1234...::my-nft::nft-token",
  },

  // Contract deployments by a specific address
  { type: "contract_deploy", deployer: "SP1234..." },

  // Print events matching a topic
  { type: "print_event", contractId: "SP1234...::token", topic: "transfer" },
]`}
				/>

				<div
					className="props-section"
					style={{ marginTop: "var(--spacing-xs)" }}
				>
					<div className="props-group-title">Filter types</div>

					<div className="prop-row">
						<span className="prop-name">stx_transfer</span>
						<span className="prop-type">
							sender, recipient, minAmount, maxAmount
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">stx_mint</span>
						<span className="prop-type">recipient, minAmount</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">stx_burn</span>
						<span className="prop-type">sender, minAmount</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">stx_lock</span>
						<span className="prop-type">lockedAddress, minAmount</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">ft_transfer</span>
						<span className="prop-type">
							sender, recipient, assetIdentifier, minAmount
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">ft_mint</span>
						<span className="prop-type">
							recipient, assetIdentifier, minAmount
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">ft_burn</span>
						<span className="prop-type">
							sender, assetIdentifier, minAmount
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">nft_transfer</span>
						<span className="prop-type">
							sender, recipient, assetIdentifier, tokenId
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">nft_mint</span>
						<span className="prop-type">
							recipient, assetIdentifier, tokenId
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">nft_burn</span>
						<span className="prop-type">sender, assetIdentifier, tokenId</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">contract_call</span>
						<span className="prop-type">contractId, functionName, caller</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">contract_deploy</span>
						<span className="prop-type">deployer, contractName</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">print_event</span>
						<span className="prop-type">contractId, topic, contains</span>
					</div>
				</div>

				<SectionHeading id="delivery-payload">Delivery payload</SectionHeading>

				<div className="prose">
					<p>
						Each delivery posts a JSON payload to your endpoint URL with the
						matching block, transactions, and events.
					</p>
				</div>

				<CodeBlock
					code={`{
  streamId: "uuid",
  streamName: "my-stream",
  block: {
    height: 150000,
    hash: "0x...",
    parentHash: "0x...",
    burnBlockHeight: 800000,
    timestamp: 1710000000,
  },
  matches: {
    transactions: [{
      txId: "0x...",
      type: "stx_transfer",
      sender: "SP1234...",
      status: "success",
      contractId: null,
      functionName: null,
    }],
    events: [{
      txId: "0x...",
      eventIndex: 0,
      type: "stx_transfer",
      data: { ... },
    }],
  },
  isBackfill: false,
  deliveredAt: "2026-03-10T00:00:00Z",
}`}
				/>

				<SectionHeading id="management">Management</SectionHeading>

				<div className="prose">
					<p>
						Streams can be enabled, disabled, updated, and deleted. Use partial
						IDs for convenience — the SDK resolves them automatically.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`// List streams
const { streams } = await client.streams.list({ status: "active" })

// Get by ID (supports partial IDs)
const stream = await client.streams.get("a1b2c3")

// Update
await client.streams.update("a1b2c3", {
  endpointUrl: "https://new-endpoint.com/streams",
  filters: [{ type: "stx_transfer", minAmount: 5_000_000 }],
})

// Enable / disable
await client.streams.enable("a1b2c3")
await client.streams.disable("a1b2c3")

// Bulk pause / resume all streams
await client.streams.pauseAll()
await client.streams.resumeAll()

// Rotate signing secret
const { secret } = await client.streams.rotateSecret("a1b2c3")

// Delete
await client.streams.delete("a1b2c3")`}
				/>

				<SectionHeading id="replay">Replay</SectionHeading>

				<div className="prose">
					<p>
						Replay historical blocks through a stream. The delivery payload
						includes <code>isBackfill: true</code> for replayed deliveries.
						Maximum 10,000 blocks per replay request.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`// Via SDK — replay blocks 150,000 to 151,000
await client.streams.replay("a1b2c3", {
  startBlock: 150_000,
  endBlock: 151_000,
})

// Replay failed deliveries
await client.streams.replayFailed("a1b2c3")`}
				/>

				<SectionHeading id="cli">CLI</SectionHeading>

				<div className="prose">
					<p>
						Manage streams from the command line. The CLI generates config files
						and registers them with the API.
					</p>
				</div>

				<CodeBlock
					code={`# Generate a new stream config
sl streams new my-stream

# Register from config file
sl streams register ./my-stream.json

# List / get / delete
sl streams ls
sl streams get a1b2c3
sl streams delete a1b2c3

# View delivery logs
sl streams logs a1b2c3

# Replay a block range
sl streams replay a1b2c3 --start 150000 --end 151000

# Rotate signing secret
sl streams rotate-secret a1b2c3`}
				/>

				<SectionHeading id="props">Props</SectionHeading>

				<div className="props-section">
					<div className="props-group-title">CreateStream</div>

					<div className="prop-row">
						<span className="prop-name">name</span>
						<span className="prop-type">string</span>
						<span className="prop-required">required</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">endpointUrl</span>
						<span className="prop-type">string</span>
						<span className="prop-required">required</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">filters</span>
						<span className="prop-type">StreamFilter[]</span>
						<span className="prop-required">required</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">options</span>
						<span className="prop-type">StreamOptions</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">startBlock</span>
						<span className="prop-type">number</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">endBlock</span>
						<span className="prop-type">number</span>
					</div>

					<div className="props-group-title">StreamOptions</div>

					<div className="prop-row">
						<span className="prop-name">decodeClarityValues</span>
						<span className="prop-type">boolean</span>
						<span className="prop-default">true</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">includeRawTx</span>
						<span className="prop-type">boolean</span>
						<span className="prop-default">false</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">includeBlockMetadata</span>
						<span className="prop-type">boolean</span>
						<span className="prop-default">true</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">rateLimit</span>
						<span className="prop-type">number</span>
						<span className="prop-default">10 (max 100)</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">timeoutMs</span>
						<span className="prop-type">number</span>
						<span className="prop-default">10000 (max 30000)</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">maxRetries</span>
						<span className="prop-type">number</span>
						<span className="prop-default">3 (max 10)</span>
					</div>

					<div className="props-group-title">StreamResponse</div>

					<div className="prop-row">
						<span className="prop-name">id</span>
						<span className="prop-type">string</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">status</span>
						<span className="prop-type">
							&apos;inactive&apos; | &apos;active&apos; | &apos;paused&apos; |
							&apos;failed&apos;
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">totalDeliveries</span>
						<span className="prop-type">number</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">failedDeliveries</span>
						<span className="prop-type">number</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">lastTriggeredAt</span>
						<span className="prop-type">string | null</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">lastTriggeredBlock</span>
						<span className="prop-type">number | null</span>
					</div>
				</div>
			</main>
		</div>
	);
}
