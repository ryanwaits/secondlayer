import { ActionExecutor } from "./actions/executor.ts";
import { analyzeWithHaiku } from "./ai/haiku-analyzer.ts";
import { diagnoseWithSonnet } from "./ai/sonnet-escalator.ts";
import { loadConfig } from "./config.ts";
import { initDb } from "./db/index.ts";
import {
	checkCooldown,
	getDailySpend,
	getLatestSnapshot,
	getRecentDecisions,
	getUnresolvedAlertForService,
	insertAlert,
	insertDecision,
	insertSnapshot,
	pruneOldRecords,
	recordCooldown,
	resolveAlert,
	updateAlertSlackTs,
} from "./db/queries.ts";
import {
	collectSystemMetrics,
	detectAnomalies,
	pollHealth,
} from "./monitor/health-poller.ts";
import { LogWatcher } from "./monitor/log-watcher.ts";
import {
	detectStaleBackups,
	scanTenantBackups,
} from "./monitor/tenant-backup-monitor.ts";
import {
	buildAlertBlocksWithButtons,
	buildDiagnosisBlocks,
} from "./notify/slack-blocks.ts";
import { handleSlackCallback } from "./notify/slack-callback.ts";
import { SlackClient } from "./notify/slack.ts";
import type { HealthStatus, PatternMatch, SystemMetrics } from "./types.ts";

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
	log(`  sonnetPermissionMode: ${config.sonnetPermissionMode}`);
	log(`  services: ${config.services.map((s) => s.name).join(", ")}`);

	// Ensure data dir exists
	const { mkdirSync } = await import("node:fs");
	mkdirSync(config.dataDir, { recursive: true });

	const db = initDb(config.dbPath);
	const executor = new ActionExecutor(config, db);
	const slack = new SlackClient({
		webhookUrl: config.slackWebhookUrl,
		apiToken: config.slackApiToken,
		channelId: config.slackChannelId,
	});

	// Track previous health state for anomaly detection
	let previousState:
		| { health: HealthStatus; metrics: SystemMetrics }
		| undefined;

	// Batch window for pattern matches (60s window → single AI call)
	let matchBatch: PatternMatch[] = [];
	let batchTimer: ReturnType<typeof setTimeout> | null = null;

	// --- Match handler ---
	// Alert dedup: max 1 alert per pattern+service per hour
	const ALERT_DEDUP_MAX_PER_HOUR = 1;

	/** Look up existing unresolved thread for a service. */
	function getThreadTs(service: string): string | undefined {
		const existing = getUnresolvedAlertForService(db, service);
		return existing?.slackTs ?? undefined;
	}

	/** Insert alert, post to Slack (with buttons in API mode), store ts back on alert row. */
	async function postAndTrackAlert(
		payload: {
			severity: Parameters<typeof insertAlert>[1]["severity"];
			service: string;
			title: string;
			message: string;
		},
		slackPayload: Parameters<SlackClient["sendAlert"]>[0],
		threadTs?: string,
	): Promise<{ alertId: number; ts: string | null }> {
		const alertId = insertAlert(db, payload);
		let ts: string | null;
		if (slack.canThread) {
			const blocks = buildAlertBlocksWithButtons(slackPayload, {
				alertId,
				service: payload.service,
			});
			ts = await slack.postAlert(blocks, threadTs);
		} else {
			ts = await slack.sendAlert(slackPayload, threadTs);
		}
		if (ts) updateAlertSlackTs(db, alertId, ts);
		return { alertId, ts };
	}

	async function handleMatch(match: PatternMatch): Promise<void> {
		log(`Pattern: ${match.name} [${match.severity}] ${match.message}`);

		// Dedup: skip if we already alerted for this pattern+service recently
		const alertKey = `alert_${match.name}`;
		if (checkCooldown(db, match.service, alertKey, ALERT_DEDUP_MAX_PER_HOUR)) {
			log(`Suppressed duplicate alert: ${match.name} on ${match.service}`);
			return;
		}
		recordCooldown(db, match.service, alertKey);

		const threadTs = getThreadTs(match.service);

		// Known action → execute directly
		if (match.action !== "escalate" && match.action !== "none") {
			const result = await executor.execute(match.action, match.service, match);

			await postAndTrackAlert(
				{
					severity: match.severity,
					service: match.service,
					title: match.name,
					message: match.message,
				},
				{
					severity: match.severity,
					title: match.name,
					service: match.service,
					details: match.message,
					action: match.action,
					outcome: result.outcome,
				},
				threadTs,
			);
			return;
		}

		// Unknown/escalate → batch for AI
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
		await postAndTrackAlert(
			{
				severity: match.severity,
				service: match.service,
				title: match.name,
				message: match.message,
			},
			{
				severity: match.severity,
				title: match.name,
				service: match.service,
				details: match.message,
			},
			threadTs,
		);
	}

	async function handleAiBatch(batch: PatternMatch[]): Promise<void> {
		if (batch.length === 0) return;

		const dailySpend = getDailySpend(db);
		if (dailySpend >= config.budgetCapDailyUsd) {
			log(
				`Budget cap reached ($${dailySpend.toFixed(4)}/$${config.budgetCapDailyUsd}) — skipping AI`,
			);
			// Budget cap is agent-level → always top-level
			await slack.sendAlert({
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
			config.anthropicApiKey,
		);

		log(
			`Haiku: ${analysis.severity} — ${analysis.diagnosis} (confidence: ${analysis.confidence})`,
		);

		insertDecision(db, {
			tier: "t2_haiku",
			trigger: batch.map((b) => b.name).join(","),
			analysis: analysis.diagnosis,
			action: analysis.suggestedAction ?? "none",
			service: batch[0].service,
			outcome: "",
			costUsd,
		});

		const threadTs = getThreadTs(batch[0].service);

		// High confidence + safe action → auto-execute
		if (
			analysis.confidence > 0.7 &&
			analysis.suggestedAction &&
			analysis.suggestedAction !== "escalate"
		) {
			const result = await executor.execute(
				analysis.suggestedAction,
				batch[0].service,
				batch[0],
			);
			await postAndTrackAlert(
				{
					severity: analysis.severity,
					service: batch[0].service,
					title: `[AI] ${batch[0].name}`,
					message: analysis.diagnosis,
				},
				{
					severity: analysis.severity,
					title: `[AI] ${batch[0].name}`,
					service: batch[0].service,
					details: `${analysis.diagnosis}\n\n*Confidence:* ${(analysis.confidence * 100).toFixed(0)}%`,
					action: analysis.suggestedAction,
					outcome: result.outcome,
					commands: analysis.commands,
				},
				threadTs,
			);
			return;
		}

		// Low confidence + severe → Sonnet escalation
		if (
			analysis.confidence < 0.5 &&
			(analysis.severity === "warn" ||
				analysis.severity === "error" ||
				analysis.severity === "critical")
		) {
			log("Escalating to Sonnet...");
			const sonnetResult = await diagnoseWithSonnet(
				batch,
				{ health: health ?? undefined, recentDecisions, latestSnapshot },
				config.anthropicApiKey,
				config.sonnetPermissionMode,
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

			const { alertId: sonnetAlertId, ts: sonnetTs } = await postAndTrackAlert(
				{
					severity: sonnetResult.diagnosis.severity,
					service: batch[0].service,
					title: `[Sonnet] ${batch[0].name}`,
					message: sonnetResult.diagnosis.diagnosis,
				},
				{
					severity: sonnetResult.diagnosis.severity,
					title: `[Sonnet] ${batch[0].name}`,
					service: batch[0].service,
					details: `${sonnetResult.diagnosis.diagnosis}\n\n*Steps:* ${sonnetResult.diagnosis.steps.join(", ")}\n*Confidence:* ${(sonnetResult.diagnosis.confidence * 100).toFixed(0)}%`,
					action: sonnetResult.diagnosis.suggestedAction ?? undefined,
					commands: sonnetResult.diagnosis.commands,
				},
				threadTs,
			);

			// Post diagnosis with action buttons in thread
			if (sonnetTs && slack.canThread) {
				const diagBlocks = buildDiagnosisBlocks(
					{
						...sonnetResult.diagnosis,
						suggestedAction:
							sonnetResult.diagnosis.suggestedAction ?? undefined,
					},
					sonnetAlertId,
					batch[0].service,
				);
				await slack.postAlert(diagBlocks, sonnetTs);
			}
			return;
		}

		// Otherwise just alert with Haiku diagnosis
		await postAndTrackAlert(
			{
				severity: analysis.severity,
				service: batch[0].service,
				title: `[AI] ${batch[0].name}`,
				message: analysis.diagnosis,
			},
			{
				severity: analysis.severity,
				title: `[AI] ${batch[0].name}`,
				service: batch[0].service,
				details: `${analysis.diagnosis}\n\n*Confidence:* ${(analysis.confidence * 100).toFixed(0)}%\n*Suggested:* ${analysis.suggestedAction ?? "none"}`,
				commands: analysis.commands,
			},
			threadTs,
		);
	}

	// --- Health poll loop ---
	async function pollLoop(): Promise<void> {
		try {
			const [health, metrics] = await Promise.all([
				pollHealth(),
				collectSystemMetrics(),
			]);
			const currentState = { health, metrics };

			// Save snapshot
			insertSnapshot(db, {
				disk: JSON.stringify({
					usedPct: metrics.diskUsedPct,
					availBytes: metrics.diskAvailBytes,
				}),
				mem: JSON.stringify({
					usedPct: metrics.memUsedPct,
					availBytes: metrics.memAvailBytes,
				}),
				gaps: String(health.integrity.totalMissing ?? 0),
				tips: JSON.stringify({
					indexer: health.indexer.lastSeenHeight,
					stacksNode: health.stacksNode.tipHeight,
				}),
				services: JSON.stringify(
					Object.fromEntries(
						config.services.map((s) => {
							// Check if container is running via docker stats
							const container = metrics.containers.find(
								(c) => c.name === s.container,
							);
							if (!container?.running) return [s.name, "down"];

							// For services with health endpoints in HealthStatus, use that
							const healthKeyMap: Record<string, keyof HealthStatus> = {
								indexer: "indexer",
								api: "api",
								"stacks-node": "stacksNode",
							};
							const healthKey = healthKeyMap[s.name];
							if (healthKey) {
								const h = health[healthKey];
								return [s.name, h?.ok ? "healthy" : "unhealthy"];
							}

							// Container is running but no health endpoint — healthy
							return [s.name, "healthy"];
						}),
					),
				),
				queue: "0",
			});

			// Detect anomalies
			const anomalies = detectAnomalies(currentState, previousState);

			// Tenant backup freshness (only alert for slugs whose pg container is running)
			const runningSlugs = new Set<string>();
			for (const c of metrics.containers) {
				const m = c.name.match(/^sl-pg-(.+?)(?:-1)?$/);
				if (m && c.running) runningSlugs.add(m[1]);
			}
			const backupStatuses = scanTenantBackups(config.tenantBackupRoot);
			anomalies.push(...detectStaleBackups(backupStatuses, runningSlugs));

			for (const anomaly of anomalies) {
				await handleMatch(anomaly);
			}

			// Auto-resolve: check for recovered services
			const anomalyServices = new Set(anomalies.map((a) => a.service));
			for (const svc of config.services) {
				if (anomalyServices.has(svc.name)) continue; // still has issues
				const unresolvedAlert = getUnresolvedAlertForService(db, svc.name);
				if (!unresolvedAlert) continue;

				resolveAlert(db, unresolvedAlert.id);
				log(`Auto-resolved alert #${unresolvedAlert.id} for ${svc.name}`);

				if (unresolvedAlert.slackTs && slack.canThread) {
					await slack.postThreadReply(
						unresolvedAlert.slackTs,
						`:white_check_mark: Recovered — ${svc.name} healthy`,
					);
				}
			}

			previousState = currentState;
			log(
				`Poll complete — disk:${metrics.diskUsedPct}% mem:${metrics.memUsedPct}% containers:${metrics.containers.length}`,
			);
		} catch (e) {
			log(`Poll error: ${e}`);
			consecutivePollFailures++;
			if (consecutivePollFailures >= 3) {
				// Poll failure is agent-level → always top-level
				await slack.sendAlert({
					severity: "error",
					title: "Agent Poll Failure",
					service: "agent",
					details: `Health poll failed ${consecutivePollFailures} consecutive times: ${e}`,
				});
			}
		}
	}

	let consecutivePollFailures = 0;
	let pollInFlight: Promise<void> | null = null;

	function runPollLoop(): Promise<void> {
		if (!pollInFlight) {
			pollInFlight = pollLoop().finally(() => {
				pollInFlight = null;
			});
		}
		return pollInFlight;
	}

	// --- Log watcher ---
	const watcher = new LogWatcher(handleMatch);
	watcher.start(config.services);
	log("Log watchers started");

	// --- Intervals ---
	const pollInterval = setInterval(() => {
		void runPollLoop();
	}, config.pollIntervalMs);

	// Daily summary at 5am UTC — guarded by timestamp to prevent double-fire
	let lastDailySummaryDate = "";
	const dailySummaryInterval = setInterval(async () => {
		const now = new Date();
		const todayStr = now.toISOString().slice(0, 10);
		if (now.getUTCHours() >= 5 && lastDailySummaryDate !== todayStr) {
			lastDailySummaryDate = todayStr;
			await runPollLoop();
			const snapshot = getLatestSnapshot(db);
			const decisions = getRecentDecisions(db, 100);
			const todayDecisions = decisions.filter((d) => {
				const created = new Date(d.createdAt ?? "");
				return created.toDateString() === now.toDateString();
			});
			await slack.sendDailySummary(snapshot, todayDecisions);
			log(`Daily summary sent from snapshot #${snapshot?.id ?? "none"}`);
		}
	}, 300_000); // Check every 5 min

	// Prune old records daily
	const pruneInterval = setInterval(() => {
		pruneOldRecords(db, 30);
		log("Pruned old records");
	}, 86_400_000);

	// --- Self-health HTTP server ---
	const startedAt = Date.now();
	const callbackDeps = {
		db,
		executor,
		slack,
		signingSecret: config.slackSigningSecret,
		anthropicApiKey: config.anthropicApiKey,
		sonnetPermissionMode: config.sonnetPermissionMode,
	};
	const server = Bun.serve({
		port: 3900,
		async fetch(_req) {
			const url = new URL(_req.url);
			if (url.pathname === "/health") {
				return Response.json({
					status: watcher.isHealthy() ? "healthy" : "degraded",
					uptime: Math.round((Date.now() - startedAt) / 1000),
					watchersConnected: watcher.getStatus().filter((w) => w.connected)
						.length,
					watchersTotal: watcher.getStatus().length,
					lastPollAt: previousState?.metrics.timestamp ?? null,
					decisionsToday: getRecentDecisions(db, 1000).filter((d) => {
						const created = new Date(d.createdAt ?? "");
						return created.toDateString() === new Date().toDateString();
					}).length,
					aiSpendToday: getDailySpend(db),
				});
			}
			if (url.pathname === "/hooks/slack" && _req.method === "POST") {
				return handleSlackCallback(_req, callbackDeps);
			}
			return new Response("Not Found", { status: 404 });
		},
	});
	log(`Health server listening on :${server.port}`);

	// --- Initial poll ---
	await runPollLoop();

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
