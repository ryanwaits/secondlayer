import type { HealthStatus, SystemMetrics, ContainerStatus, PatternMatch } from "../types.ts";

const TIMEOUT = 5_000;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  return res.json() as Promise<T>;
}

export async function pollHealth(): Promise<HealthStatus> {
  const indexerHost = process.env.INDEXER_URL ?? "http://indexer:3700";
  const apiHost = process.env.API_URL ?? "http://api:3800";
  const nodeServerUrl = process.env.NODE_SERVER_URL ?? "http://37.27.171.220";
  const stacksNodeHost = process.env.STACKS_NODE_URL ?? `${nodeServerUrl}:20443`;

  const [indexer, api, stacksNode, integrity] = await Promise.allSettled([
    fetchJson<{ lastSeenHeight?: number }>(`${indexerHost}/health`),
    fetchJson(`${apiHost}/health`),
    fetchJson<{ stacks_tip_height?: number; burn_block_height?: number }>(`${stacksNodeHost}/v2/info`),
    fetchJson<{ gaps?: number; totalMissing?: number }>(`${indexerHost}/health/integrity`),
  ]);

  // Distinguish node server network unreachability from a crashed local container
  let stacksNodeResult: HealthStatus["stacksNode"];
  if (stacksNode.status === "fulfilled") {
    stacksNodeResult = {
      ok: true,
      tipHeight: stacksNode.value.stacks_tip_height,
      burnHeight: stacksNode.value.burn_block_height,
    };
  } else {
    const reason = String((stacksNode as PromiseRejectedResult).reason);
    const isNetworkError =
      reason.includes("ECONNREFUSED") ||
      reason.includes("ENOTFOUND") ||
      reason.includes("ETIMEDOUT") ||
      reason.includes("fetch failed") ||
      reason.includes("NetworkError");
    if (isNetworkError) {
      console.warn(`[health-poller] Node server unreachable at ${stacksNodeHost}: ${reason}`);
      stacksNodeResult = { ok: false, error: "node_server_unreachable" };
    } else {
      stacksNodeResult = { ok: false, error: reason };
    }
  }

  return {
    indexer:
      indexer.status === "fulfilled"
        ? { ok: true, lastSeenHeight: indexer.value.lastSeenHeight }
        : { ok: false, error: String((indexer as PromiseRejectedResult).reason) },
    api:
      api.status === "fulfilled"
        ? { ok: true }
        : { ok: false, error: String((api as PromiseRejectedResult).reason) },
    stacksNode: stacksNodeResult,
    integrity:
      integrity.status === "fulfilled"
        ? { ok: true, gaps: integrity.value.gaps, totalMissing: integrity.value.totalMissing }
        : { ok: false, error: String((integrity as PromiseRejectedResult).reason) },
  };
}

// collectSystemMetrics covers app server containers only (node server containers are not accessible via Docker)
export async function collectSystemMetrics(): Promise<SystemMetrics> {
  // Disk
  const dfResult = Bun.spawnSync(["df", "-B1", "/"]);
  const dfLines = dfResult.stdout.toString().trim().split("\n");
  let diskUsedPct = 0;
  let diskAvailBytes = 0;
  if (dfLines.length >= 2) {
    const parts = dfLines[1].split(/\s+/);
    diskUsedPct = parseInt(parts[4]?.replace("%", "") ?? "0");
    diskAvailBytes = parseInt(parts[3] ?? "0");
  }

  // Memory
  const freeResult = Bun.spawnSync(["free", "-b"]);
  const freeLines = freeResult.stdout.toString().trim().split("\n");
  let memUsedPct = 0;
  let memAvailBytes = 0;
  if (freeLines.length >= 2) {
    const parts = freeLines[1].split(/\s+/);
    const total = parseInt(parts[1] ?? "1");
    const avail = parseInt(parts[6] ?? "0");
    memAvailBytes = avail;
    memUsedPct = Math.round(((total - avail) / total) * 100);
  }

  // Docker stats
  const statsResult = Bun.spawnSync(["docker", "stats", "--no-stream", "--format", "{{json .}}"]);
  const containers: ContainerStatus[] = [];

  for (const line of statsResult.stdout.toString().trim().split("\n")) {
    if (!line) continue;
    try {
      const s = JSON.parse(line);
      const memUsage = parseFloat(s.MemUsage?.split("/")[0]?.replace(/[^0-9.]/g, "") ?? "0");
      const memLimit = parseFloat(s.MemUsage?.split("/")[1]?.replace(/[^0-9.]/g, "") ?? "0");

      // Get restart count + started time
      const inspectResult = Bun.spawnSync([
        "docker",
        "inspect",
        "--format",
        "{{.RestartCount}}|{{.State.StartedAt}}",
        s.Name,
      ]);
      const inspectParts = inspectResult.stdout.toString().trim().split("|");
      const restartCount = parseInt(inspectParts[0]) || 0;
      const startedAt = inspectParts[1] ? new Date(inspectParts[1]).getTime() || undefined : undefined;

      containers.push({
        name: s.Name,
        cpuPct: parseFloat(s.CPUPerc?.replace("%", "") ?? "0"),
        memUsageMb: memUsage,
        memLimitMb: memLimit,
        restartCount,
        running: true,
        startedAt,
      });
    } catch {
      // skip malformed lines
    }
  }

  return { diskUsedPct, diskAvailBytes, memUsedPct, memAvailBytes, containers, timestamp: Date.now() };
}

export function detectAnomalies(
  current: { health: HealthStatus; metrics: SystemMetrics },
  previous?: { health: HealthStatus; metrics: SystemMetrics }
): PatternMatch[] {
  const anomalies: PatternMatch[] = [];
  const now = Date.now();

  // Disk >85%
  if (current.metrics.diskUsedPct > 85) {
    anomalies.push({
      name: "disk_high",
      severity: current.metrics.diskUsedPct > 95 ? "critical" : "warn",
      action: "prune_docker",
      service: "system",
      message: `Disk usage at ${current.metrics.diskUsedPct}%`,
      line: "",
      timestamp: now,
    });
  }

  // No new blocks in >5 minutes — but only if the node is caught up
  if (
    previous &&
    current.health.indexer.ok &&
    previous.health.indexer.ok &&
    current.health.indexer.lastSeenHeight === previous.health.indexer.lastSeenHeight
  ) {
    // Check if stacks-node is still syncing (node tip is moving but indexer tip isn't, or node tip is far from burn chain)
    const nodeTip = current.health.stacksNode.tipHeight;
    const prevNodeTip = previous.health.stacksNode.tipHeight;
    const nodeStillSyncing = nodeTip && prevNodeTip && nodeTip !== prevNodeTip && nodeTip > (current.health.indexer.lastSeenHeight ?? 0);

    if (nodeStillSyncing) {
      // Node is syncing — indexer will catch up, suppress alert
    } else if (!current.health.stacksNode.ok) {
      // Node is down — that's the root cause, don't spam about indexer
    } else {
      anomalies.push({
        name: "no_new_blocks",
        severity: "warn",
        action: "alert_only",
        service: "indexer",
        message: `No new blocks since height ${current.health.indexer.lastSeenHeight}`,
        line: "",
        timestamp: now,
      });
    }
  }

  // Gap count increased
  if (
    previous &&
    current.health.integrity.ok &&
    previous.health.integrity.ok &&
    (current.health.integrity.totalMissing ?? 0) > (previous.health.integrity.totalMissing ?? 0)
  ) {
    anomalies.push({
      name: "gap_increase",
      severity: "warn",
      action: "alert_only",
      service: "indexer",
      message: `Gap count increased to ${current.health.integrity.totalMissing}`,
      line: "",
      timestamp: now,
    });
  }

  // Restart count >3/hr for any container
  for (const c of current.metrics.containers) {
    if (c.restartCount > 3) {
      anomalies.push({
        name: "restart_loop",
        severity: "error",
        action: "alert_only",
        service: c.name,
        message: `Container ${c.name} restarted ${c.restartCount} times`,
        line: "",
        timestamp: now,
      });
    }
  }

  // Chain tip lag >10 blocks (indexer vs stacks-node)
  // Only alert if node tip is stable (not actively syncing)
  if (
    current.health.indexer.ok &&
    current.health.stacksNode.ok &&
    current.health.stacksNode.tipHeight &&
    current.health.indexer.lastSeenHeight &&
    previous?.health.stacksNode.ok
  ) {
    const lag = current.health.stacksNode.tipHeight - current.health.indexer.lastSeenHeight;
    const prevNodeTip = previous.health.stacksNode.tipHeight ?? 0;
    const nodeAdvanced = current.health.stacksNode.tipHeight - prevNodeTip;
    // If node advanced >50 blocks in one poll interval, it's bulk syncing — don't alert
    const nodeBulkSyncing = nodeAdvanced > 50;

    if (lag > 10 && !nodeBulkSyncing) {
      anomalies.push({
        name: "chain_tip_lag",
        severity: "warn",
        action: "alert_only",
        service: "indexer",
        message: `Indexer lagging ${lag} blocks behind stacks-node`,
        line: "",
        timestamp: now,
      });
    }
  }

  // Service down — check if recently restarted (within 5min) to avoid false positives
  const containerByService = new Map(
    current.metrics.containers.map((c) => [c.name.replace(/^secondlayer-|-1$/g, ""), c])
  );
  const RECENT_RESTART_MS = 5 * 60 * 1000;

  for (const { ok, error, svc } of [
    { ok: current.health.indexer.ok, error: current.health.indexer.error, svc: "indexer" },
    { ok: current.health.api.ok, error: current.health.api.error, svc: "api" },
  ] as const) {
    if (ok) continue;
    const container = containerByService.get(svc);
    const recentlyRestarted = container?.startedAt && (now - container.startedAt) < RECENT_RESTART_MS;

    if (recentlyRestarted) {
      anomalies.push({
        name: "service_restarted",
        severity: "info",
        action: "alert_only",
        service: svc,
        message: `${svc} recently restarted, health check not yet passing: ${error}`,
        line: "",
        timestamp: now,
      });
    } else {
      anomalies.push({
        name: "service_down",
        severity: "error",
        action: "restart_service",
        service: svc,
        message: `${svc.charAt(0).toUpperCase() + svc.slice(1)} health check failed: ${error}`,
        line: "",
        timestamp: now,
      });
    }
  }

  return anomalies;
}
