#!/usr/bin/env bun
/**
 * Seed script — populates streams_dev with realistic Stacks blockchain data.
 * Run: bun run seed
 */
import { getDb, closeDb, sql } from "./index.ts";
import { jsonb } from "./jsonb.ts";
const db = getDb();

// ── Helpers ─────────────────────────────────────────────────────────
const randomHex = (len: number) =>
  Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join("");

const randomHash = () => `0x${randomHex(64)}`;
const randomTxId = () => `0x${randomHex(64)}`;

const stxAddresses = [
  "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
  "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
  "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1",
  "SP2C2YFP12AJZB1MADC9PK03NGKJQ8MFGE4ESPDAZ",
  "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9",
  "SP1HTBVD3JG9C05J7HBJTHGR0GGW7KXW28M5JS8QE",
];

const contractIds = [
  "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.arkadiko-token",
  "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sbtc-deposit",
  "SP2C2YFP12AJZB1MADC9PK03NGKJQ8MFGE4ESPDAZ.alex-vault",
  "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.stackingdao-core",
  null, null, // some txs have no contract
];

const txTypes = ["contract_call", "contract_call", "contract_call", "token_transfer", "smart_contract"];
const fnNames = ["transfer", "deposit", "swap", "stake", "claim-rewards", "mint", null];
const eventTypes = ["stx_transfer", "ft_transfer", "nft_mint", "contract_event", "stx_lock"];

const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

console.log("Seeding database...\n");

// ── 1. Accounts ─────────────────────────────────────────────────────
const accountEmails = [
  "ryan@secondlayer.xyz",
  "alice@stacksbuilder.io",
  "bob@defi-labs.com",
  "carol@nft-studio.xyz",
  "dave@stacking.capital",
];

const accountRows = await db
  .insertInto("accounts")
  .values(accountEmails.map((email, i) => ({
    email,
    plan: i === 0 ? "pro" : i < 3 ? "builder" : "free",
  })))
  .onConflict((oc) => oc.column("email").doUpdateSet({ email: sql`accounts.email` }))
  .returningAll()
  .execute();

console.log(`  accounts: ${accountRows.length}`);

// ── 2. API Keys ─────────────────────────────────────────────────────
const apiKeyRows = await db
  .insertInto("api_keys")
  .values(accountRows.map((a, i) => ({
    key_hash: randomHex(64),
    key_prefix: `sk-sl_${randomHex(4)}`,
    name: `${a.email.split("@")[0]}-key-${i + 1}`,
    account_id: a.id,
    ip_address: `192.168.1.${10 + i}`,
    last_used_at: new Date(),
  })))
  .returningAll()
  .execute();

console.log(`  api_keys: ${apiKeyRows.length}`);

// ── 3. Blocks (200 blocks starting at height 180000) ────────────────
const BLOCK_START = 180000;
const BLOCK_COUNT = 200;
const blocks = Array.from({ length: BLOCK_COUNT }, (_, i) => {
  const height = BLOCK_START + i;
  return {
    height,
    hash: randomHash(),
    parent_hash: randomHash(),
    burn_block_height: 850000 + i,
    timestamp: Math.floor(Date.now() / 1000) - (BLOCK_COUNT - i) * 600, // ~10min apart
    canonical: true,
  };
});

await db.insertInto("blocks").values(blocks).onConflict((oc) => oc.column("height").doNothing()).execute();
console.log(`  blocks: ${BLOCK_COUNT}`);

// ── 4. Transactions (~3-5 per block) ────────────────────────────────
const txRows: Array<{
  tx_id: string;
  block_height: number;
  type: string;
  sender: string;
  status: string;
  contract_id: string | null;
  function_name: string | null;
  raw_tx: string;
}> = [];

for (const block of blocks) {
  const txCount = 3 + Math.floor(Math.random() * 3);
  for (let j = 0; j < txCount; j++) {
    const type = pick(txTypes);
    const contractId = type === "token_transfer" ? null : pick(contractIds);
    txRows.push({
      tx_id: randomTxId(),
      block_height: block.height,
      type,
      sender: pick(stxAddresses),
      status: Math.random() > 0.05 ? "success" : "abort_by_response",
      contract_id: contractId,
      function_name: contractId ? pick(fnNames.filter(Boolean)) : null,
      raw_tx: randomHex(200),
    });
  }
}

// batch insert in chunks
for (let i = 0; i < txRows.length; i += 100) {
  await db.insertInto("transactions").values(txRows.slice(i, i + 100)).onConflict((oc) => oc.column("tx_id").doNothing()).execute();
}
console.log(`  transactions: ${txRows.length}`);

// ── 5. Events (~1-3 per transaction) ────────────────────────────────
const eventRows: Array<{
  tx_id: string;
  block_height: number;
  event_index: number;
  type: string;
  data: ReturnType<typeof jsonb>;
}> = [];

for (const tx of txRows) {
  const eventCount = 1 + Math.floor(Math.random() * 3);
  for (let j = 0; j < eventCount; j++) {
    const type = pick(eventTypes);
    const data: Record<string, unknown> = { type };

    if (type === "stx_transfer" || type === "ft_transfer") {
      data.sender = tx.sender;
      data.recipient = pick(stxAddresses);
      data.amount = String(Math.floor(Math.random() * 10000000));
      if (type === "ft_transfer") data.asset_identifier = pick(contractIds.filter(Boolean)) + "::token";
    } else if (type === "nft_mint") {
      data.recipient = tx.sender;
      data.asset_identifier = pick(contractIds.filter(Boolean)) + "::nft";
      data.value = { type: "uint", value: String(Math.floor(Math.random() * 10000)) };
    } else if (type === "contract_event") {
      data.contract_identifier = tx.contract_id;
      data.topic = "print";
      data.value = { message: "operation completed", code: Math.floor(Math.random() * 100) };
    } else if (type === "stx_lock") {
      data.locked_amount = String(Math.floor(Math.random() * 50000000000));
      data.unlock_height = tx.block_height + 2100;
      data.locked_address = tx.sender;
    }

    eventRows.push({
      tx_id: tx.tx_id,
      block_height: tx.block_height,
      event_index: j,
      type,
      data: jsonb(data) as any,
    });
  }
}

for (let i = 0; i < eventRows.length; i += 100) {
  await db.insertInto("events").values(eventRows.slice(i, i + 100)).execute();
}
console.log(`  events: ${eventRows.length}`);

// ── 6. Streams ──────────────────────────────────────────────────────
const streamDefs = [
  { name: "stx-transfers", filters: { type: "stx_transfer" }, webhook: "https://hooks.slack.com/stx-alerts" },
  { name: "nft-mints", filters: { type: "nft_mint" }, webhook: "https://api.nft-tracker.io/webhook" },
  { name: "defi-swaps", filters: { contract_id: "SP2C2YFP12AJZB1MADC9PK03NGKJQ8MFGE4ESPDAZ.alex-vault", function_name: "swap" }, webhook: "https://defi-dash.xyz/ingest" },
  { name: "sbtc-deposits", filters: { contract_id: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sbtc-deposit" }, webhook: "https://sbtc-monitor.secondlayer.xyz/hook" },
  { name: "all-contract-calls", filters: { type: "contract_call" }, webhook: "https://analytics.stacksbuilder.io/events" },
  { name: "stacking-events", filters: { type: "stx_lock" }, webhook: "https://stacking.capital/api/notify" },
];

const streamRows = await db
  .insertInto("streams")
  .values(streamDefs.map((s, i) => ({
    name: s.name,
    status: i < 5 ? "active" : "paused",
    filters: jsonb(s.filters) as any,
    webhook_url: s.webhook,
    webhook_secret: `whsec_${randomHex(32)}`,
    api_key_id: apiKeyRows[i % apiKeyRows.length].id,
  })))
  .returningAll()
  .execute();

console.log(`  streams: ${streamRows.length}`);

// ── 7. Stream Metrics ───────────────────────────────────────────────
await db
  .insertInto("stream_metrics")
  .values(streamRows.map((s, i) => ({
    stream_id: s.id,
    last_triggered_at: new Date(Date.now() - Math.random() * 3600000),
    last_triggered_block: BLOCK_START + BLOCK_COUNT - 1 - Math.floor(Math.random() * 10),
    total_deliveries: 50 + Math.floor(Math.random() * 500),
    failed_deliveries: Math.floor(Math.random() * 10),
    error_message: i === 3 ? "Connection timeout after 30s" : null,
  })))
  .execute();

console.log(`  stream_metrics: ${streamRows.length}`);

// ── 8. Jobs (~2 per stream per recent block) ────────────────────────
const jobValues: Array<{
  stream_id: string;
  block_height: number;
  status: string;
  attempts: number;
  completed_at: Date | null;
  error: string | null;
}> = [];

for (const stream of streamRows) {
  for (let h = BLOCK_START + BLOCK_COUNT - 20; h < BLOCK_START + BLOCK_COUNT; h++) {
    const status = Math.random() > 0.1 ? "completed" : Math.random() > 0.5 ? "failed" : "pending";
    jobValues.push({
      stream_id: stream.id,
      block_height: h,
      status,
      attempts: status === "completed" ? 1 : status === "failed" ? 3 : 0,
      completed_at: status === "completed" ? new Date(Date.now() - Math.random() * 3600000) : null,
      error: status === "failed" ? "Webhook returned 503 Service Unavailable" : null,
    });
  }
}

const jobRows = await db
  .insertInto("jobs")
  .values(jobValues)
  .returningAll()
  .execute();

console.log(`  jobs: ${jobRows.length}`);

// ── 9. Deliveries ───────────────────────────────────────────────────
const deliveryValues: Array<{
  stream_id: string;
  job_id: string | null;
  block_height: number;
  status: string;
  status_code: number | null;
  response_time_ms: number | null;
  error: string | null;
  payload: ReturnType<typeof jsonb>;
}> = [];

for (const job of jobRows.filter((j) => j.status === "completed" || j.status === "failed")) {
  deliveryValues.push({
    stream_id: job.stream_id,
    job_id: job.id,
    block_height: job.block_height,
    status: job.status === "completed" ? "delivered" : "failed",
    status_code: job.status === "completed" ? 200 : 503,
    response_time_ms: 50 + Math.floor(Math.random() * 450),
    error: job.error,
    payload: jsonb({
      block_height: job.block_height,
      events: [{ type: pick(eventTypes), data: {} }],
    }) as any,
  });
}

for (let i = 0; i < deliveryValues.length; i += 100) {
  await db.insertInto("deliveries").values(deliveryValues.slice(i, i + 100)).execute();
}
console.log(`  deliveries: ${deliveryValues.length}`);

// ── 10. Views ───────────────────────────────────────────────────────
const viewDefs = [
  { name: "token-balances", def: { tables: ["balances"], source: "ft_transfer" }, handler: "./views/token-balances.ts" },
  { name: "nft-ownership", def: { tables: ["owners"], source: "nft_mint" }, handler: "./views/nft-ownership.ts" },
  { name: "stacking-summary", def: { tables: ["stacks"], source: "stx_lock" }, handler: "./views/stacking-summary.ts" },
  { name: "contract-activity", def: { tables: ["calls"], source: "contract_call" }, handler: "./views/contract-activity.ts" },
];

await db
  .insertInto("views")
  .values(viewDefs.map((v, i) => ({
    name: v.name,
    definition: jsonb(v.def) as any,
    schema_hash: randomHex(16),
    handler_path: v.handler,
    schema_name: `view_${apiKeyRows[i % apiKeyRows.length].key_prefix.replace("sk-sl_", "")}_${v.name.replace(/-/g, "_")}`,
    api_key_id: apiKeyRows[i % apiKeyRows.length].id,
    last_processed_block: BLOCK_START + BLOCK_COUNT - 1 - Math.floor(Math.random() * 5),
    total_processed: 1000 + Math.floor(Math.random() * 5000),
    total_errors: Math.floor(Math.random() * 20),
  })))
  .onConflict((oc) => oc.columns(["name", "api_key_id"]).doNothing())
  .execute();

console.log(`  views: ${viewDefs.length}`);

// ── 11. Index Progress ──────────────────────────────────────────────
await db
  .insertInto("index_progress")
  .values({
    network: "mainnet",
    last_indexed_block: BLOCK_START + BLOCK_COUNT - 1,
    last_contiguous_block: BLOCK_START + BLOCK_COUNT - 1,
    highest_seen_block: BLOCK_START + BLOCK_COUNT + 2,
  })
  .onConflict((oc) => oc.column("network").doUpdateSet({
    last_indexed_block: BLOCK_START + BLOCK_COUNT - 1,
    last_contiguous_block: BLOCK_START + BLOCK_COUNT - 1,
    highest_seen_block: BLOCK_START + BLOCK_COUNT + 2,
  }))
  .execute();

console.log(`  index_progress: 1`);

// ── 12. Sessions ────────────────────────────────────────────────────
await db
  .insertInto("sessions")
  .values(accountRows.slice(0, 3).map((a) => ({
    token_hash: randomHex(64),
    token_prefix: `sess_${randomHex(4)}`,
    account_id: a.id,
    ip_address: "127.0.0.1",
    last_used_at: new Date(),
  })))
  .execute();

console.log(`  sessions: 3`);

// ── 13. Usage Daily ─────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

await db
  .insertInto("usage_daily")
  .values(accountRows.flatMap((a) => [
    { account_id: a.id, date: today, api_requests: 50 + Math.floor(Math.random() * 200), deliveries: 10 + Math.floor(Math.random() * 100) },
    { account_id: a.id, date: yesterday, api_requests: 80 + Math.floor(Math.random() * 300), deliveries: 20 + Math.floor(Math.random() * 150) },
  ]))
  .onConflict((oc) => oc.columns(["account_id", "date"]).doNothing())
  .execute();

console.log(`  usage_daily: ${accountRows.length * 2}`);

// ── Done ────────────────────────────────────────────────────────────
console.log("\nDone!\n");
await closeDb();
