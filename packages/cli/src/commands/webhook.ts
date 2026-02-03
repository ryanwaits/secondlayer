import { Command } from "commander";
import { join } from "node:path";
import { success, error, dim } from "../lib/output.ts";
import { loadConfig, requireLocalNetwork } from "../lib/config.ts";

export function registerWebhookCommand(program: Command): void {
  const webhook = program
    .command("webhook")
    .description("Webhook development tools")
    .hook("preAction", async () => { await requireLocalNetwork(); });

  webhook
    .command("init <directory>")
    .description("Scaffold a webhook handler with types and signature verification")
    .option("-n, --name <name>", "Stream name", "my-stream")
    .option("--network <network>", "Network (mainnet/testnet)", "mainnet")
    .option("-p, --port <port>", "Server port", "4000")
    .action(async (directory: string, options: { name: string; network: string; port: string }) => {
      try {
        const config = await loadConfig();
        const port = parseInt(options.port);
        const network = options.network as "mainnet" | "testnet";

        // Check if directory exists
        const dir = join(process.cwd(), directory);
        const dirExists = await Bun.file(join(dir, "package.json")).exists();
        if (dirExists) {
          error(`Directory ${directory} already contains a project`);
          process.exit(1);
        }

        await Bun.$`mkdir -p ${dir}`.quiet();

        // Generate files
        await generateServerFile(dir, port);
        await generateTypesFile(dir);
        await generateStreamJson(dir, options.name, network, port, config.defaultWebhookUrl);
        await generateEnvFile(dir);
        await generatePackageJson(dir, options.name);

        success(`Created webhook handler in ${directory}/`);
        console.log("");
        console.log("  Files created:");
        console.log(`    ${dim("server.ts")}      Webhook server with HMAC verification`);
        console.log(`    ${dim("types.ts")}       Payload type definitions`);
        console.log(`    ${dim("stream.json")}    Stream configuration`);
        console.log(`    ${dim(".env")}           Environment variables`);
        console.log(`    ${dim("package.json")}   Dependencies`);
        console.log("");
        console.log("  Next steps:");
        console.log(`    cd ${directory}`);
        console.log("    bun install");
        console.log("    bun server.ts");
        console.log("");
        console.log("  Then register your stream:");
        console.log(`    sl streams register ${directory}/stream.json`);
        console.log("");
      } catch (err) {
        error(`Failed to scaffold webhook: ${err}`);
        process.exit(1);
      }
    });
}

async function generateServerFile(dir: string, port: number): Promise<void> {
  const content = `import type { WebhookPayload } from "./types.ts";

const WEBHOOK_SECRET = process.env.STREAMS_WEBHOOK_SECRET;

/**
 * Verify HMAC signature from Stacks Streams
 */
async function verifySignature(body: string, signature: string | null): Promise<boolean> {
  if (!WEBHOOK_SECRET || !signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = Buffer.from(sig).toString("hex");

  return signature === expected;
}

/**
 * Handle incoming webhook payload
 */
async function handlePayload(payload: WebhookPayload): Promise<void> {
  console.log(\`Block \${payload.block.height}: \${payload.matches.events.length} events\`);

  for (const event of payload.matches.events) {
    switch (event.type) {
      case "stx_transfer_event":
        console.log(\`  STX transfer: \${event.data.amount} from \${event.data.sender}\`);
        // TODO: Insert into your database
        break;

      case "ft_transfer_event":
        console.log(\`  FT transfer: \${event.data.amount} of \${event.data.asset_identifier}\`);
        break;

      case "nft_transfer_event":
        console.log(\`  NFT transfer: \${event.data.asset_identifier}\`);
        break;

      case "contract_call":
        console.log(\`  Contract call: \${event.data.contract_id}.\${event.data.function_name}\`);
        break;

      default:
        console.log(\`  Event: \${event.type}\`);
    }
  }
}

Bun.serve({
  port: ${port},

  async fetch(req) {
    const url = new URL(req.url);

    // Health check
    if (req.method === "GET" && url.pathname === "/health") {
      return new Response("ok");
    }

    // Webhook endpoint
    if (req.method === "POST" && url.pathname === "/payload") {
      const body = await req.text();
      const signature = req.headers.get("x-streams-signature");

      // Verify signature
      if (WEBHOOK_SECRET) {
        const valid = await verifySignature(body, signature);
        if (!valid) {
          console.error("Invalid signature");
          return new Response("Invalid signature", { status: 401 });
        }
      }

      try {
        const payload: WebhookPayload = JSON.parse(body);
        await handlePayload(payload);
        return new Response("ok");
      } catch (err) {
        console.error("Failed to process payload:", err);
        return new Response("Internal error", { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(\`Webhook server listening on http://localhost:${port}/payload\`);
`;

  await Bun.write(join(dir, "server.ts"), content);
}

async function generateTypesFile(dir: string): Promise<void> {
  const content = `/**
 * Stacks Streams Webhook Payload Types
 *
 * These types match the payload structure sent by Stacks Streams.
 */

export interface WebhookPayload {
  streamId: string;
  streamName: string;
  network: "mainnet" | "testnet";
  block: BlockMetadata;
  matches: {
    transactions: TransactionMatch[];
    events: EventMatch[];
  };
  isBackfill: boolean;
  deliveredAt: string;
}

export interface BlockMetadata {
  height: number;
  hash: string;
  parentHash: string;
  burnBlockHeight: number;
  timestamp: number;
}

export interface TransactionMatch {
  txId: string;
  type: string;
  sender: string;
  status: "success" | "abort_by_response" | "abort_by_post_condition";
  contractId: string | null;
  functionName: string | null;
  rawTx?: string;
}

export type EventMatch =
  | StxTransferEvent
  | FtTransferEvent
  | NftTransferEvent
  | ContractCallEvent
  | PrintEvent
  | GenericEvent;

interface BaseEvent {
  txId: string;
  eventIndex: number;
}

export interface StxTransferEvent extends BaseEvent {
  type: "stx_transfer_event";
  data: {
    sender: string;
    recipient: string;
    amount: string;
    memo: string;
  };
}

export interface FtTransferEvent extends BaseEvent {
  type: "ft_transfer_event";
  data: {
    sender: string;
    recipient: string;
    amount: string;
    asset_identifier: string;
  };
}

export interface NftTransferEvent extends BaseEvent {
  type: "nft_transfer_event";
  data: {
    sender: string;
    recipient: string;
    asset_identifier: string;
    value: unknown;
  };
}

export interface ContractCallEvent extends BaseEvent {
  type: "contract_call";
  data: {
    contract_id: string;
    function_name: string;
    function_args: unknown[];
  };
}

export interface PrintEvent extends BaseEvent {
  type: "print_event";
  data: {
    contract_id: string;
    topic: string;
    value: unknown;
  };
}

export interface GenericEvent extends BaseEvent {
  type: string;
  data: unknown;
}

/**
 * Type guard to narrow event types
 */
export function isStxTransfer(event: EventMatch): event is StxTransferEvent {
  return event.type === "stx_transfer_event";
}

export function isFtTransfer(event: EventMatch): event is FtTransferEvent {
  return event.type === "ft_transfer_event";
}

export function isNftTransfer(event: EventMatch): event is NftTransferEvent {
  return event.type === "nft_transfer_event";
}

export function isContractCall(event: EventMatch): event is ContractCallEvent {
  return event.type === "contract_call";
}

export function isPrintEvent(event: EventMatch): event is PrintEvent {
  return event.type === "print_event";
}
`;

  await Bun.write(join(dir, "types.ts"), content);
}

async function generateStreamJson(
  dir: string,
  name: string,
  network: string,
  port: number,
  _defaultWebhookUrl?: string
): Promise<void> {
  const content = {
    name,
    network,
    webhookUrl: `http://localhost:${port}/payload`,
    filters: [
      {
        type: "stx_transfer",
        minAmount: 1000000,
      },
    ],
    options: {
      decodeClarityValues: true,
      includeRawTx: false,
      includeBlockMetadata: true,
      rateLimit: 10,
      timeoutMs: 10000,
      maxRetries: 3,
    },
  };

  await Bun.write(join(dir, "stream.json"), JSON.stringify(content, null, 2) + "\n");
}

async function generateEnvFile(dir: string): Promise<void> {
  const content = `# Stacks Streams Webhook Secret
# Get this from: sl streams register stream.json
STREAMS_WEBHOOK_SECRET=

# Add your database connection, etc.
# DATABASE_URL=postgres://...
`;

  await Bun.write(join(dir, ".env"), content);
}

async function generatePackageJson(dir: string, name: string): Promise<void> {
  const content = {
    name: `${name}-webhook`,
    version: "0.1.0",
    type: "module",
    scripts: {
      start: "bun server.ts",
      dev: "bun --watch server.ts",
    },
    dependencies: {},
    devDependencies: {
      "@types/bun": "latest",
    },
  };

  await Bun.write(join(dir, "package.json"), JSON.stringify(content, null, 2) + "\n");
}
