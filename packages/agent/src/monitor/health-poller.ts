import type { HealthStatus, SystemMetrics, ContainerStatus, PatternMatch } from "../types.ts";

const TIMEOUT = 5_000;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  return res.json() as Promise<T>;
}

export async function pollHealth(): Promise<HealthStatus> {
  const [indexer, api, stacksNode, integrity] = await Promise.allSettled([
    fetchJson<{ lastSeenHeight?: number }>("http://localhost:3700/health"),
    fetchJson("http://localhost:3800/health"),
    fetchJson<{ stacks_tip_height?: number; burn_block_height?: number }>("http://localhost:20443/v2/info"),
    fetchJson<{ gaps?: number; totalMissing?: number }>("http://localhost:3700/health/integrity"),
  ]);

  return {
    indexer:
      indexer.status === "fulfilled"
        ? { ok: true, lastSeenHeight: indexer.value.lastSeenHeight }
        : { ok: false, error: String((indexer as PromiseRejectedResult).reason) },
    api:
      api.status === "fulfilled"
        ? { ok: true }
        : { ok: false, error: String((api as PromiseRejectedResult).reason) },
    stacksNode:
      stacksNode.status === "fulfilled"
        ? { ok: true, tipHeight: stacksNode.value.stacks_tip_height, burnHeight: stacksNode.value.burn_block_height }
        : { ok: false, error: String((stacksNode as PromiseRejectedResult).reason) },
    integrity:
      integrity.status === "fulfilled"
        ? { ok: true, gaps: integrity.value.gaps, totalMissing: integrity.value.totalMissing }
        : { ok: false, error: String((integrity as PromiseRejectedResult).reason) },
  };
}

export async function collectSystemMetrics(): Promise<SystemMetrics> {
  // Disk
  const dfResult = Bun.spawnSync(["df", "-B1", "/opt/secondlayer/data"]);
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

      // Get restart count
      const inspectResult = Bun.spawnSync([
        "docker",
        "inspect",
        "--format",
        "{{.RestartCount}}",
        s.Name,
      ]);
      const restartCount = parseInt(inspectResult.stdout.toString().trim()) || 0;

      containers.push({
        name: s.Name,
        cpuPct: parseFloat(s.CPUPerc?.replace("%", "") ?? "0"),
        memUsageMb: memUsage,
        memLimitMb: memLimit,
        restartCount,
        running: true,
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

  // No new blocks in >5 minutes
  if (
    previous &&
    current.health.indexer.ok &&
    previous.health.indexer.ok &&
    current.health.indexer.lastSeenHeight === previous.health.indexer.lastSeenHeight
  ) {
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
  if (
    current.health.indexer.ok &&
    current.health.stacksNode.ok &&
    current.health.stacksNode.tipHeight &&
    current.health.indexer.lastSeenHeight
  ) {
    const lag = current.health.stacksNode.tipHeight - current.health.indexer.lastSeenHeight;
    if (lag > 10) {
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

  // Service down
  if (!current.health.indexer.ok) {
    anomalies.push({
      name: "service_down",
      severity: "error",
      action: "restart_service",
      service: "indexer",
      message: `Indexer health check failed: ${current.health.indexer.error}`,
      line: "",
      timestamp: now,
    });
  }
  if (!current.health.api.ok) {
    anomalies.push({
      name: "service_down",
      severity: "error",
      action: "restart_service",
      service: "api",
      message: `API health check failed: ${current.health.api.error}`,
      line: "",
      timestamp: now,
    });
  }

  return anomalies;
}
