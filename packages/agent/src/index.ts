import { loadConfig } from "./config.ts";
import { initDb } from "./db/index.ts";
import {
  insertSnapshot,
  insertAlert,
  getRecentDecisions,
  getLatestSnapshot,
  getDailySpend,
  pruneOldRecords,
} from "./db/queries.ts";
import { pollHealth, collectSystemMetrics, detectAnomalies } from "./monitor/health-poller.ts";
import { LogWatcher } from "./monitor/log-watcher.ts";
import { ActionExecutor } from "./actions/executor.ts";
import { sendSlackAlert, sendDailySummary } from "./notify/slack.ts";
import { analyzeWithHaiku } from "./ai/haiku-analyzer.ts";
import { diagnoseWithSonnet } from "./ai/sonnet-escalator.ts";
import { insertDecision } from "./db/queries.ts";
import type { PatternMatch, HealthStatus, SystemMetrics } from "./types.ts";

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [agent] ${msg}`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  log("Starting agent...");
  log(`  dataDir: ${config.dataDir}`);
  log(`  dbPath: ${config.dbPath}`);
  log(`  pollInterval: ${config.pollIntervalMs}ms`);
  log(`  dryRun: ${config.dryRun}`);
  log(`  aiEnabled: ${config.aiEnabled}`);
  log(`  services: ${config.services.map((s) => s.name).join(", ")}`);

  // Ensure data dir exists
  const { mkdirSync } = await import("fs");
  mkdirSync(config.dataDir, { recursive: true });

  const db = initDb(config.dbPath);
  const executor = new ActionExecutor(config, db);

  // Track previous health state for anomaly detection
  let previousState: { health: HealthStatus; metrics: SystemMetrics } | undefined;

  // Batch window for pattern matches (60s window → single AI call)
  let matchBatch: PatternMatch[] = [];
  let batchTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Match handler ---
  async function handleMatch(match: PatternMatch): Promise<void> {
    log(`Pattern: ${match.name} [${match.severity}] ${match.message}`);

    insertAlert(db, {
      severity: match.severity,
      service: match.service,
      title: match.name,
      message: match.message,
    });

    // Known action → execute directly
    if (match.action !== "escalate" && match.action !== "none") {
      const result = await executor.execute(match.action, match.service, match);

      await sendSlackAlert(config.slackWebhookUrl, {
        severity: match.severity,
        title: match.name,
        service: match.service,
        details: match.message,
        action: match.action,
        outcome: result.outcome,
      });
      return;
    }

    // Unknown/escalate → batch for AI (Sprint 5)
    if (config.aiEnabled && match.action === "escalate") {
      matchBatch.push(match);
      if (!batchTimer) {
        batchTimer = setTimeout(async () => {
          const batch = [...matchBatch];
          matchBatch = [];
          batchTimer = null;
          await handleAiBatch(batch);
        }, 60_000);
      }
      return;
    }

    // No AI → alert only
    await sendSlackAlert(config.slackWebhookUrl, {
      severity: match.severity,
      title: match.name,
      service: match.service,
      details: match.message,
    });
  }

  async function handleAiBatch(batch: PatternMatch[]): Promise<void> {
    if (batch.length === 0) return;

    const dailySpend = getDailySpend(db);
    if (dailySpend >= config.budgetCapDailyUsd) {
      log(`Budget cap reached ($${dailySpend.toFixed(4)}/$${config.budgetCapDailyUsd}) — skipping AI`);
      await sendSlackAlert(config.slackWebhookUrl, {
        severity: "warn",
        title: "Budget Cap Reached",
        service: "agent",
        details: `AI budget exceeded ($${dailySpend.toFixed(4)}/$${config.budgetCapDailyUsd}). ${batch.length} patterns queued but not analyzed.`,
      });
      return;
    }

    // Haiku analysis
    log(`Running Haiku analysis on ${batch.length} pattern(s)...`);
    const health = previousState?.health;
    const recentDecisions = getRecentDecisions(db, 10);
    const latestSnapshot = getLatestSnapshot(db);

    const { analysis, costUsd } = await analyzeWithHaiku(
      batch,
      { health: health ?? undefined, recentDecisions, latestSnapshot },
      config.anthropicApiKey
    );

    log(`Haiku: ${analysis.severity} — ${analysis.diagnosis} (confidence: ${analysis.confidence})`);

    insertDecision(db, {
      tier: "t2_haiku",
      trigger: batch.map((b) => b.name).join(","),
      analysis: analysis.diagnosis,
      action: analysis.suggestedAction ?? "none",
      service: batch[0].service,
      outcome: "",
      costUsd,
    });

    // High confidence + safe action → auto-execute
    if (analysis.confidence > 0.7 && analysis.suggestedAction && analysis.suggestedAction !== "escalate") {
      const result = await executor.execute(analysis.suggestedAction, batch[0].service, batch[0]);
      await sendSlackAlert(config.slackWebhookUrl, {
        severity: analysis.severity,
        title: `[AI] ${batch[0].name}`,
        service: batch[0].service,
        details: `${analysis.diagnosis}\n\n*Confidence:* ${(analysis.confidence * 100).toFixed(0)}%`,
        action: analysis.suggestedAction,
        outcome: result.outcome,
      });
      return;
    }

    // Low confidence + severe → Sonnet escalation
    if (analysis.confidence < 0.5 && (analysis.severity === "warn" || analysis.severity === "error" || analysis.severity === "critical")) {
      log("Escalating to Sonnet...");
      const sonnetResult = await diagnoseWithSonnet(
        batch,
        { health: health ?? undefined, recentDecisions, latestSnapshot },
        config.anthropicApiKey
      );

      insertDecision(db, {
        tier: "t3_sonnet",
        trigger: batch.map((b) => b.name).join(","),
        analysis: sonnetResult.diagnosis.diagnosis,
        action: sonnetResult.diagnosis.suggestedAction ?? "none",
        service: batch[0].service,
        outcome: "",
        costUsd: sonnetResult.costUsd,
      });

      await sendSlackAlert(config.slackWebhookUrl, {
        severity: sonnetResult.diagnosis.severity,
        title: `[Sonnet] ${batch[0].name}`,
        service: batch[0].service,
        details: `${sonnetResult.diagnosis.diagnosis}\n\n*Steps:* ${sonnetResult.diagnosis.steps.join(", ")}\n*Confidence:* ${(sonnetResult.diagnosis.confidence * 100).toFixed(0)}%`,
        action: sonnetResult.diagnosis.suggestedAction ?? undefined,
      });
      return;
    }

    // Otherwise just alert with Haiku diagnosis
    await sendSlackAlert(config.slackWebhookUrl, {
      severity: analysis.severity,
      title: `[AI] ${batch[0].name}`,
      service: batch[0].service,
      details: `${analysis.diagnosis}\n\n*Confidence:* ${(analysis.confidence * 100).toFixed(0)}%\n*Suggested:* ${analysis.suggestedAction ?? "none"}`,
    });
  }

  // --- Health poll loop ---
  async function pollLoop(): Promise<void> {
    try {
      const [health, metrics] = await Promise.all([pollHealth(), collectSystemMetrics()]);
      const currentState = { health, metrics };

      // Save snapshot
      insertSnapshot(db, {
        disk: JSON.stringify({ usedPct: metrics.diskUsedPct, availBytes: metrics.diskAvailBytes }),
        mem: JSON.stringify({ usedPct: metrics.memUsedPct, availBytes: metrics.memAvailBytes }),
        gaps: String(health.integrity.totalMissing ?? 0),
        tips: JSON.stringify({
          indexer: health.indexer.lastSeenHeight,
          stacksNode: health.stacksNode.tipHeight,
        }),
        services: JSON.stringify(
          Object.fromEntries(
            config.services.map((s) => {
              const key = s.name as keyof HealthStatus;
              const h = health[key];
              return [s.name, h && typeof h === "object" && "ok" in h ? (h.ok ? "healthy" : "unhealthy") : "unknown"];
            })
          )
        ),
        queue: "0",
      });

      // Detect anomalies
      const anomalies = detectAnomalies(currentState, previousState);
      for (const anomaly of anomalies) {
        await handleMatch(anomaly);
      }

      previousState = currentState;
      log(`Poll complete — disk:${metrics.diskUsedPct}% mem:${metrics.memUsedPct}% containers:${metrics.containers.length}`);
    } catch (e) {
      log(`Poll error: ${e}`);
      consecutivePollFailures++;
      if (consecutivePollFailures >= 3) {
        await sendSlackAlert(config.slackWebhookUrl, {
          severity: "error",
          title: "Agent Poll Failure",
          service: "agent",
          details: `Health poll failed ${consecutivePollFailures} consecutive times: ${e}`,
        });
      }
    }
  }

  let consecutivePollFailures = 0;

  // --- Log watcher ---
  const watcher = new LogWatcher(handleMatch);
  watcher.start(config.services);
  log("Log watchers started");

  // --- Intervals ---
  const pollInterval = setInterval(pollLoop, config.pollIntervalMs);

  // Daily summary at 5am UTC
  const dailySummaryInterval = setInterval(async () => {
    const now = new Date();
    if (now.getUTCHours() === 5 && now.getUTCMinutes() < 6) {
      const snapshot = getLatestSnapshot(db);
      const decisions = getRecentDecisions(db, 100);
      const todayDecisions = decisions.filter((d) => {
        const created = new Date(d.createdAt ?? "");
        return created.toDateString() === now.toDateString();
      });
      await sendDailySummary(config.slackWebhookUrl, snapshot, todayDecisions);
      log("Daily summary sent");
    }
  }, 300_000); // Check every 5 min

  // Prune old records daily
  const pruneInterval = setInterval(() => {
    pruneOldRecords(db, 30);
    log("Pruned old records");
  }, 86_400_000);

  // --- Self-health HTTP server ---
  const startedAt = Date.now();
  const server = Bun.serve({
    port: 3900,
    fetch(_req) {
      const url = new URL(_req.url);
      if (url.pathname === "/health") {
        return Response.json({
          status: watcher.isHealthy() ? "healthy" : "degraded",
          uptime: Math.round((Date.now() - startedAt) / 1000),
          watchersConnected: watcher.getStatus().filter((w) => w.connected).length,
          watchersTotal: watcher.getStatus().length,
          lastPollAt: previousState?.metrics.timestamp ?? null,
          decisionsToday: getRecentDecisions(db, 1000).filter((d) => {
            const created = new Date(d.createdAt ?? "");
            return created.toDateString() === new Date().toDateString();
          }).length,
          aiSpendToday: getDailySpend(db),
        });
      }
      return new Response("Not Found", { status: 404 });
    },
  });
  log(`Health server listening on :${server.port}`);

  // --- Initial poll ---
  await pollLoop();

  // --- Graceful shutdown ---
  function shutdown(): void {
    log("Shutting down...");
    watcher.stop();
    clearInterval(pollInterval);
    clearInterval(dailySummaryInterval);
    clearInterval(pruneInterval);
    if (batchTimer) clearTimeout(batchTimer);
    server.stop();
    db.close();
    log("Shutdown complete");
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
