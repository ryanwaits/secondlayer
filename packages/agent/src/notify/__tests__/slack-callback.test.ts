import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { createHmac } from "crypto";
import { initDb } from "../../db/index.ts";
import { insertAlert, updateAlertSlackTs, getAlertById } from "../../db/queries.ts";
import { SlackClient } from "../slack.ts";
import { handleSlackCallback, type CallbackDeps } from "../slack-callback.ts";

const SECRET = "test_signing_secret";

let db: Database;
let deps: CallbackDeps;
const originalFetch = globalThis.fetch;

function makeSignedRequest(body: string, opts?: { secret?: string; timestamp?: string }): Request {
  const ts = opts?.timestamp ?? String(Math.floor(Date.now() / 1000));
  const secret = opts?.secret ?? SECRET;
  const sig = "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");

  return new Request("http://localhost:3900/hooks/slack", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-slack-signature": sig,
      "x-slack-request-timestamp": ts,
    },
    body,
  });
}

function makePayload(actionId: string, value: object, messageTs = "1111.2222"): string {
  const payload = JSON.stringify({
    type: "block_actions",
    actions: [{ action_id: actionId, value: JSON.stringify(value) }],
    user: { id: "U123", username: "testuser" },
    message: { ts: messageTs, blocks: [{ type: "header", text: { type: "plain_text", text: "Test" } }] },
    channel: { id: "C123" },
  });
  return `payload=${encodeURIComponent(payload)}`;
}

beforeEach(() => {
  db = initDb(":memory:");
  // Mock fetch for Slack API calls
  globalThis.fetch = mock(async () => Response.json({ ok: true, ts: "9999.9999" })) as unknown as typeof fetch;

  deps = {
    db,
    executor: {
      execute: mock(async () => ({ outcome: "success", detail: "Restarted indexer" })),
    } as unknown as CallbackDeps["executor"],
    slack: new SlackClient({ webhookUrl: "", apiToken: "xoxb-test", channelId: "C123" }),
    signingSecret: SECRET,
    anthropicApiKey: "sk-test",
  };
});

afterEach(() => {
  db.close();
  globalThis.fetch = originalFetch;
});

describe("handleSlackCallback", () => {
  test("rejects invalid signature with 401", async () => {
    const body = makePayload("agent_dismiss", { alertId: 1, service: "indexer", action: "agent_dismiss" });
    const req = makeSignedRequest(body, { secret: "wrong_secret" });

    const res = await handleSlackCallback(req, deps);
    expect(res.status).toBe(401);
  });

  test("rejects replay attack with 401", async () => {
    const body = makePayload("agent_dismiss", { alertId: 1, service: "indexer", action: "agent_dismiss" });
    const oldTs = String(Math.floor(Date.now() / 1000) - 400);
    const req = makeSignedRequest(body, { timestamp: oldTs });

    const res = await handleSlackCallback(req, deps);
    expect(res.status).toBe(401);
  });

  test("dismiss resolves alert", async () => {
    const alertId = insertAlert(db, {
      severity: "error",
      service: "indexer",
      title: "OOM",
      message: "test",
    });
    updateAlertSlackTs(db, alertId, "1111.2222");

    const body = makePayload("agent_dismiss", { alertId, service: "indexer", action: "agent_dismiss" });
    const req = makeSignedRequest(body);

    const res = await handleSlackCallback(req, deps);
    expect(res.status).toBe(200);

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 100));

    const alert = getAlertById(db, alertId);
    expect(alert?.resolvedAt).not.toBeNull();
  });

  test("restart calls executor", async () => {
    const alertId = insertAlert(db, {
      severity: "error",
      service: "indexer",
      title: "Down",
      message: "test",
    });
    updateAlertSlackTs(db, alertId, "1111.2222");

    const body = makePayload("agent_restart", { alertId, service: "indexer", action: "agent_restart" });
    const req = makeSignedRequest(body);

    const res = await handleSlackCallback(req, deps);
    expect(res.status).toBe(200);

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 100));

    expect(deps.executor.execute).toHaveBeenCalled();
    const alert = getAlertById(db, alertId);
    expect(alert?.resolvedAt).not.toBeNull();
  });

  test("returns 200 for unknown alert", async () => {
    const body = makePayload("agent_dismiss", { alertId: 99999, service: "indexer", action: "agent_dismiss" });
    const req = makeSignedRequest(body);

    const res = await handleSlackCallback(req, deps);
    expect(res.status).toBe(200);
  });
});
