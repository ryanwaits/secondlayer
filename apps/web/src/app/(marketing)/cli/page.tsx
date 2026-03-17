import { Sidebar } from "@/components/sidebar";
import { SectionHeading } from "@/components/section-heading";
import { CodeBlock } from "@/components/code-block";
import type { TocItem } from "@/components/sidebar";

const toc: TocItem[] = [
  { label: "Install", href: "#install" },
  { label: "Auth", href: "#auth" },
  { label: "Streams", href: "#streams" },
  { label: "Subgraphs", href: "#subgraphs" },
  { label: "Codegen", href: "#codegen" },
  { label: "Local dev", href: "#local-dev" },
  { label: "Commands", href: "#commands" },
];

export default function CliPage() {
  return (
    <div className="article-layout">
      <Sidebar title="CLI" toc={toc} />

      <main className="content-area">
        <header className="page-header">
          <h1 className="page-title">CLI</h1>
          <p className="page-date">March 10, 2026</p>
        </header>

        <div className="prose">
          <p>
            The <code>sl</code> command manages streams, subgraphs, auth, code
            generation, and local development infrastructure from the terminal.
            One binary, every Second Layer operation.
          </p>
          <p>
            Install globally with <code>bun add -g @secondlayer/cli</code>.
          </p>
        </div>

        <SectionHeading id="install">Install</SectionHeading>

        <CodeBlock code={`bun add -g @secondlayer/cli

# Verify
sl --version

# Interactive setup — network, auth, node config
sl setup`} lang="bash" />

        <div className="prose">
          <p>
            <code>sl setup</code> walks you through network selection
            (local, testnet, mainnet), authentication via magic link, and
            optional Stacks node configuration.
          </p>
        </div>

        <SectionHeading id="auth">Auth</SectionHeading>

        <div className="prose">
          <p>
            Login with your email via magic link. The CLI creates a{" "}
            <code>cli-&lt;hostname&gt;</code> API key and stores it in{" "}
            <code>~/.secondlayer/config.json</code>. Session tokens are never
            persisted.
          </p>
        </div>

        <CodeBlock code={`# Login — sends magic link, creates API key
sl auth login

# Check current auth
sl auth status

# Rotate API key (revoke old + create new)
sl auth rotate

# Manage keys
sl auth keys list
sl auth keys create --name "deploy"
sl auth keys revoke <id>

# Logout — revokes key server-side
sl auth logout`} lang="bash" />

        <SectionHeading id="streams">Streams</SectionHeading>

        <div className="prose">
          <p>
            Scaffold, register, and manage event streams from the CLI.
          </p>
        </div>

        <CodeBlock code={`# Scaffold a new stream config
sl streams new my-stream

# Register with the API
sl streams register streams/my-stream.json

# List streams (optionally filter by status)
sl streams ls
sl streams ls --status active

# Get stream details
sl streams get <id>

# Enable / disable
sl streams set <id> enable
sl streams set <id> disable

# View delivery logs (--follow for real-time)
sl streams logs <id>
sl streams logs <id> --follow

# Replay a block range (max 10,000 blocks)
sl streams replay <id> --start 150000 --end 160000

# Rotate signing secret
sl streams rotate-secret <id>

# Delete (with confirmation)
sl streams delete <id>`} lang="bash" />

        <SectionHeading id="subgraphs">Subgraphs</SectionHeading>

        <div className="prose">
          <p>
            Deploy and manage indexed subgraphs. The CLI bundles handler code with
            esbuild, diffs schema changes, and handles deployment.
          </p>
        </div>

        <CodeBlock code={`# Scaffold a new subgraph
sl subgraphs new token-transfers

# Deploy to Second Layer
sl subgraphs deploy subgraphs/token-transfers.ts

# Dev mode — watches for changes, hot-redeploys
sl subgraphs dev subgraphs/token-transfers.ts

# Check indexing status and health
sl subgraphs status token-transfers

# Query a deployed subgraph
sl subgraphs query token-transfers transfers --sort _block_height --order desc
sl subgraphs query token-transfers transfers --filter sender=SP1234... --limit 25
sl subgraphs query token-transfers transfers --filter "amount.gte=1000000" --count

# Reindex from scratch or a specific range
sl subgraphs reindex token-transfers
sl subgraphs reindex token-transfers --from 150000 --to 160000

# Scaffold a subgraph from a deployed contract's ABI
sl subgraphs scaffold SP1234...::my-contract --output subgraphs/my-contract.ts

# Generate a typed client from a deployed subgraph
sl subgraphs generate token-transfers --output src/generated/

# Delete subgraph and all data
sl subgraphs delete token-transfers`} lang="bash" />

        <SectionHeading id="codegen">Codegen</SectionHeading>

        <div className="prose">
          <p>
            Generate TypeScript interfaces from Clarity contracts. Supports
            local <code>.clar</code> files and deployed contract addresses.
            Works with the plugin system for React hooks, testing utilities,
            and transaction actions.
          </p>
        </div>

        <CodeBlock code={`# Initialize config file
sl init

# Generate types from config
sl generate

# Generate from specific files
sl generate contracts/my-contract.clar

# Watch mode — regenerate on file change
sl generate --watch

# Specify output path
sl generate --output src/generated/contracts.ts`} lang="bash" />

        <SectionHeading id="local-dev">Local dev</SectionHeading>

        <div className="prose">
          <p>
            Run the full Second Layer stack locally for development. Manages
            the API, indexer, worker, delivery receiver, and optionally a
            Stacks node — all via Docker.
          </p>
        </div>

        <CodeBlock code={`# Start all services
sl local start

# Check status
sl local status

# View logs (with service filtering)
sl local logs --service indexer

# Manage local Stacks node
sl local node setup
sl local node start
sl local node logs
sl local node stop

# Start/stop the full stack (node + services)
sl stack start
sl stack stop

# Inspect indexed data
sl db blocks
sl db txs --limit 20
sl db events
sl db gaps

# Sync missing blocks
sl sync --from 150000 --to 160000
sl sync --gaps

# System diagnostics
sl doctor

# Stop everything
sl local stop`} lang="bash" />

        <SectionHeading id="commands">Commands</SectionHeading>

        <div className="props-section">
          <div className="props-group-title">Core</div>

          <div className="prop-row">
            <span className="prop-name">sl setup</span>
            <span className="prop-type">Interactive onboarding</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl status</span>
            <span className="prop-type">System health — DB, queue, indexing, streams</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl whoami</span>
            <span className="prop-type">Current authenticated account</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl doctor</span>
            <span className="prop-type">Diagnostic check (local + hosted)</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl init</span>
            <span className="prop-type">Create secondlayer.config.ts</span>
          </div>

          <div className="props-group-title">Auth</div>

          <div className="prop-row">
            <span className="prop-name">sl auth login</span>
            <span className="prop-type">Magic link → API key</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl auth logout</span>
            <span className="prop-type">Revoke key + clear config</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl auth status</span>
            <span className="prop-type">Show key, email, plan</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl auth rotate</span>
            <span className="prop-type">Revoke + create new key</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl auth keys [list|create|revoke]</span>
            <span className="prop-type">Key management</span>
          </div>

          <div className="props-group-title">Streams</div>

          <div className="prop-row">
            <span className="prop-name">sl streams new &lt;name&gt;</span>
            <span className="prop-type">Scaffold stream config</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl streams register &lt;file&gt;</span>
            <span className="prop-type">Register from JSON file</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl streams ls</span>
            <span className="prop-type">List all streams</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl streams get &lt;id&gt;</span>
            <span className="prop-type">Stream details</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl streams set &lt;id&gt; &lt;state&gt;</span>
            <span className="prop-type">Enable / disable stream</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl streams logs &lt;id&gt;</span>
            <span className="prop-type">Delivery log (--follow)</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl streams replay &lt;id&gt;</span>
            <span className="prop-type">Replay block range</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl streams rotate-secret &lt;id&gt;</span>
            <span className="prop-type">New signing secret</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl streams delete &lt;id&gt;</span>
            <span className="prop-type">Delete stream</span>
          </div>

          <div className="props-group-title">Subgraphs</div>

          <div className="prop-row">
            <span className="prop-name">sl subgraphs new &lt;name&gt;</span>
            <span className="prop-type">Scaffold subgraph definition</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl subgraphs deploy &lt;file&gt;</span>
            <span className="prop-type">Deploy (local or remote)</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl subgraphs dev &lt;file&gt;</span>
            <span className="prop-type">Watch + hot-redeploy</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl subgraphs status &lt;name&gt;</span>
            <span className="prop-type">Indexing status + health</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl subgraphs query &lt;name&gt; &lt;table&gt;</span>
            <span className="prop-type">Query with filters, sort, count</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl subgraphs reindex &lt;name&gt;</span>
            <span className="prop-type">Reindex (--from, --to)</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl subgraphs scaffold &lt;contract&gt;</span>
            <span className="prop-type">Generate subgraph from ABI</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl subgraphs generate &lt;name&gt;</span>
            <span className="prop-type">Generate typed client</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl subgraphs delete &lt;name&gt;</span>
            <span className="prop-type">Delete subgraph + data</span>
          </div>

          <div className="props-group-title">Codegen</div>

          <div className="prop-row">
            <span className="prop-name">sl init</span>
            <span className="prop-type">Create config file</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl generate [files...]</span>
            <span className="prop-type">Generate TS from Clarity contracts</span>
          </div>

          <div className="props-group-title">Database</div>

          <div className="prop-row">
            <span className="prop-name">sl db blocks</span>
            <span className="prop-type">Recent indexed blocks</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl db txs</span>
            <span className="prop-type">Recent transactions</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl db events</span>
            <span className="prop-type">Recent events</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl db gaps</span>
            <span className="prop-type">Gaps in indexed data</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl db reset</span>
            <span className="prop-type">Truncate all indexed data</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl sync</span>
            <span className="prop-type">Fetch + index missing blocks</span>
          </div>

          <div className="props-group-title">Config</div>

          <div className="prop-row">
            <span className="prop-name">sl config show</span>
            <span className="prop-type">Print current config</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl config set &lt;key&gt; &lt;value&gt;</span>
            <span className="prop-type">Set config value (dot notation)</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl config reset</span>
            <span className="prop-type">Reset to defaults</span>
          </div>

          <div className="props-group-title">Local</div>

          <div className="prop-row">
            <span className="prop-name">sl local start / stop / restart</span>
            <span className="prop-type">Dev services lifecycle</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl local status</span>
            <span className="prop-type">Environment status</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl local logs</span>
            <span className="prop-type">Service logs (--service filter)</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl local node [setup|start|stop|logs]</span>
            <span className="prop-type">Stacks node management</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl stack start / stop</span>
            <span className="prop-type">Full stack (node + services)</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sl receiver init &lt;dir&gt;</span>
            <span className="prop-type">Scaffold receiver handler</span>
          </div>
        </div>
      </main>
    </div>
  );
}
