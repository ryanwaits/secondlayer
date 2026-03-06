export interface ServiceConfig {
  name: string;
  container: string;
  healthUrl?: string;
  autoRestart: boolean;
}

export interface AgentConfig {
  dataDir: string;
  dbPath: string;
  composeCmd: string[];
  composeDir: string;
  slackWebhookUrl: string;
  slackApiToken: string;
  slackChannelId: string;
  slackSigningSecret: string;
  anthropicApiKey: string;
  pollIntervalMs: number;
  budgetCapDailyUsd: number;
  maxRestartsPerHour: number;
  services: ServiceConfig[];
  aiEnabled: boolean;
  dryRun: boolean;
  nodeServerUrl: string;
}

export const SAFE_RESTART = [
  "indexer",
  "api",
  "worker",
  "view-processor",
  "caddy",
] as const;

export const NEVER_RESTART = ["stacks-node"] as const; // runs on remote node server — cannot restart

export const WARN_RESTART = ["postgres"] as const;

const DEFAULT_SERVICES: ServiceConfig[] = [
  { name: "indexer", container: "secondlayer-indexer-1", healthUrl: "http://localhost:3700/health", autoRestart: true },
  { name: "api", container: "secondlayer-api-1", healthUrl: "http://localhost:3800/health", autoRestart: true },
  { name: "worker", container: "secondlayer-worker-1", autoRestart: true },
  { name: "view-processor", container: "secondlayer-view-processor-1", autoRestart: true },
  { name: "postgres", container: "secondlayer-postgres-1", autoRestart: false },
  { name: "caddy", container: "secondlayer-caddy-1", autoRestart: true },
  // stacks-node runs on node server (remote) — not accessible via Docker DNS
];

export function loadConfig(): AgentConfig {
  const dataDir = process.env.AGENT_DATA_DIR ?? "/data/agent";
  const composeDir = process.env.COMPOSE_DIR ?? "/opt/secondlayer/docker";

  return {
    dataDir,
    dbPath: process.env.AGENT_DB_PATH ?? `${dataDir}/agent.db`,
    composeCmd: (
      process.env.COMPOSE_CMD ??
      `docker compose -f ${composeDir}/docker-compose.yml -f ${composeDir}/docker-compose.hetzner.yml`
    ).split(" "),
    composeDir,
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL ?? "",
    slackApiToken: process.env.SLACK_API_TOKEN ?? "",
    slackChannelId: process.env.SLACK_CHANNEL_ID ?? "",
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET ?? "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
    pollIntervalMs: Number(process.env.AGENT_POLL_INTERVAL_MS) || 300_000,
    budgetCapDailyUsd: Number(process.env.AGENT_BUDGET_CAP_DAILY_USD) || 5,
    maxRestartsPerHour: Number(process.env.AGENT_MAX_RESTARTS_PER_HOUR) || 3,
    services: DEFAULT_SERVICES,
    aiEnabled: process.env.AGENT_AI_ENABLED !== "false",
    dryRun: process.env.AGENT_DRY_RUN === "true",
    nodeServerUrl: process.env.NODE_SERVER_URL ?? "http://37.27.171.220",
  };
}
