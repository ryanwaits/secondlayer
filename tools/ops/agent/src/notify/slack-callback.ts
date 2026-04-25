import type { Database } from "bun:sqlite";
import type { ActionExecutor } from "../actions/executor.ts";
import { diagnoseWithSonnet } from "../ai/sonnet-escalator.ts";
import { getAlertById, resolveAlert } from "../db/queries.ts";
import type { PatternMatch } from "../types.ts";
import { addResolvedFooter, buildDiagnosisBlocks } from "./slack-blocks.ts";
import type { ButtonAction } from "./slack-blocks.ts";
import { verifySlackSignature } from "./slack-verify.ts";
import type { SlackClient } from "./slack.ts";

function log(msg: string): void {
	console.log(`[${new Date().toISOString()}] [slack-callback] ${msg}`);
}

export interface CallbackDeps {
	db: Database;
	executor: ActionExecutor;
	slack: SlackClient;
	signingSecret: string;
	anthropicApiKey: string;
}

export async function handleSlackCallback(
	req: Request,
	deps: CallbackDeps,
): Promise<Response> {
	const { db, executor, slack, signingSecret, anthropicApiKey } = deps;

	// Read body
	const body = await req.text();
	const signature = req.headers.get("x-slack-signature") ?? "";
	const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";

	// Verify signature
	if (!verifySlackSignature(signingSecret, signature, timestamp, body)) {
		log("Invalid signature");
		return new Response("Unauthorized", { status: 401 });
	}

	// Parse payload
	let payload: {
		type?: string;
		actions?: Array<{ action_id: string; value: string }>;
		user?: { id: string; username: string };
		message?: { ts: string; blocks?: object[] };
		channel?: { id: string };
	};
	try {
		const params = new URLSearchParams(body);
		payload = JSON.parse(params.get("payload") ?? "{}");
	} catch {
		return new Response("Bad Request", { status: 400 });
	}

	// Handle URL verification (Slack sends this on initial setup)
	if (payload.type === "url_verification") {
		return Response.json({
			challenge: (payload as unknown as { challenge: string }).challenge,
		});
	}

	if (payload.type !== "block_actions" || !payload.actions?.length) {
		return new Response("OK", { status: 200 });
	}

	const action = payload.actions[0];
	const user = payload.user?.username ?? "unknown";

	let parsed: ButtonAction;
	try {
		parsed = JSON.parse(action.value);
	} catch {
		return new Response("Bad value", { status: 400 });
	}

	const alert = getAlertById(db, parsed.alertId);
	if (!alert) {
		log(`Alert #${parsed.alertId} not found`);
		return new Response("OK", { status: 200 });
	}

	const messageTs = payload.message?.ts;
	const originalBlocks = payload.message?.blocks ?? [];

	// Return 200 immediately, process async
	const response = new Response("", { status: 200 });

	// Async processing
	(async () => {
		try {
			switch (action.action_id) {
				case "agent_dismiss": {
					resolveAlert(db, parsed.alertId);
					if (messageTs) {
						await slack.updateMessage(
							messageTs,
							addResolvedFooter(originalBlocks, `Dismissed by @${user}`),
						);
					}
					log(`Alert #${parsed.alertId} dismissed by ${user}`);
					break;
				}

				case "agent_restart": {
					const match: PatternMatch = {
						name: alert.title,
						severity: alert.severity,
						service: alert.service,
						message: alert.message,
						action: "restart_service",
						line: "",
						timestamp: Date.now(),
					};
					const result = await executor.execute(
						"restart_service",
						parsed.service,
						match,
					);
					resolveAlert(db, parsed.alertId);

					if (messageTs) {
						await slack.postThreadReply(
							messageTs,
							`Restart triggered by @${user}: ${result.outcome} — ${result.detail}`,
						);
						await slack.updateMessage(
							messageTs,
							addResolvedFooter(originalBlocks, `Restarted by @${user}`),
						);
					}
					log(`Alert #${parsed.alertId} restart by ${user}: ${result.outcome}`);
					break;
				}

				case "agent_investigate": {
					if (messageTs) {
						await slack.postThreadReply(
							messageTs,
							`:mag: Investigating... (triggered by @${user})`,
						);
					}

					const match: PatternMatch = {
						name: alert.title,
						severity: alert.severity,
						service: alert.service,
						message: alert.message,
						action: "escalate",
						line: "",
						timestamp: Date.now(),
					};

					const { diagnosis } = await diagnoseWithSonnet(
						[match],
						{},
						anthropicApiKey,
					);

					if (messageTs) {
						const diagBlocks = buildDiagnosisBlocks(
							{
								...diagnosis,
								suggestedAction: diagnosis.suggestedAction ?? undefined,
							},
							parsed.alertId,
							parsed.service,
						);
						await slack.postThreadReply(messageTs, "");
						// Post diagnosis as blocks in thread
						await slack.postAlert(diagBlocks, messageTs);
					}
					log(`Alert #${parsed.alertId} investigated by ${user}`);
					break;
				}

				case "agent_verify": {
					if (messageTs) {
						await slack.postThreadReply(
							messageTs,
							`:mag: Running health check... (triggered by @${user})`,
						);
					}
					// Import dynamically to avoid circular deps
					const { pollHealth } = await import("../monitor/health-poller.ts");
					const health = await pollHealth();
					const summary = Object.entries(health)
						.map(
							([k, v]) =>
								`${k}: ${v && typeof v === "object" && "ok" in v ? (v.ok ? ":white_check_mark:" : ":x:") : ":question:"}`,
						)
						.join("\n");

					if (messageTs) {
						await slack.postThreadReply(
							messageTs,
							`*Health check results:*\n${summary}`,
						);
					}
					log(`Alert #${parsed.alertId} verified by ${user}`);
					break;
				}

				case "agent_execute_suggested": {
					// action format: "agent_execute:<actionType>"
					const execAction = parsed.action.replace("agent_execute:", "");
					const match: PatternMatch = {
						name: alert.title,
						severity: alert.severity,
						service: alert.service,
						message: alert.message,
						action: execAction as PatternMatch["action"],
						line: "",
						timestamp: Date.now(),
					};

					const result = await executor.execute(
						execAction as PatternMatch["action"],
						parsed.service,
						match,
					);
					resolveAlert(db, parsed.alertId);

					if (messageTs) {
						await slack.postThreadReply(
							messageTs,
							`Executed \`${execAction}\` by @${user}: ${result.outcome} — ${result.detail}`,
						);
						await slack.updateMessage(
							messageTs,
							addResolvedFooter(
								originalBlocks,
								`Executed ${execAction} by @${user}`,
							),
						);
					}
					log(
						`Alert #${parsed.alertId} execute ${execAction} by ${user}: ${result.outcome}`,
					);
					break;
				}

				default:
					log(`Unknown action: ${action.action_id}`);
			}
		} catch (e) {
			log(`Callback error for ${action.action_id}: ${e}`);
		}
	})();

	return response;
}
