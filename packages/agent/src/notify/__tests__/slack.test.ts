import { describe, test, expect, mock, afterEach } from "bun:test";
import { SlackClient, buildAlertBlocks } from "../slack.ts";

// Mock fetch globally
const originalFetch = globalThis.fetch;

describe("SlackClient", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("canThread", () => {
    test("true when apiToken + channelId set", () => {
      const client = new SlackClient({ webhookUrl: "", apiToken: "xoxb-test", channelId: "C123" });
      expect(client.canThread).toBe(true);
    });

    test("false when no apiToken", () => {
      const client = new SlackClient({ webhookUrl: "https://hooks.slack.com/test" });
      expect(client.canThread).toBe(false);
    });

    test("false when no channelId", () => {
      const client = new SlackClient({ webhookUrl: "", apiToken: "xoxb-test" });
      expect(client.canThread).toBe(false);
    });
  });

  describe("API mode", () => {
    test("postAlert returns ts", async () => {
      globalThis.fetch = mock(async () =>
        Response.json({ ok: true, ts: "1234567890.123456" })
      ) as unknown as typeof fetch;

      const client = new SlackClient({ webhookUrl: "", apiToken: "xoxb-test", channelId: "C123" });
      const ts = await client.postAlert([{ type: "section", text: { type: "mrkdwn", text: "test" } }]);
      expect(ts).toBe("1234567890.123456");
    });

    test("postAlert with threadTs passes thread_ts", async () => {
      let capturedBody: string = "";
      globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as string;
        return Response.json({ ok: true, ts: "1234567890.999" });
      }) as unknown as typeof fetch;

      const client = new SlackClient({ webhookUrl: "", apiToken: "xoxb-test", channelId: "C123" });
      await client.postAlert([{ type: "section" }], "1111.2222");

      const parsed = JSON.parse(capturedBody);
      expect(parsed.thread_ts).toBe("1111.2222");
    });

    test("postThreadReply sends thread reply", async () => {
      let capturedBody: string = "";
      globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as string;
        return Response.json({ ok: true, ts: "9999.8888" });
      }) as unknown as typeof fetch;

      const client = new SlackClient({ webhookUrl: "", apiToken: "xoxb-test", channelId: "C123" });
      const ts = await client.postThreadReply("1111.2222", "Recovery message");

      expect(ts).toBe("9999.8888");
      const parsed = JSON.parse(capturedBody);
      expect(parsed.thread_ts).toBe("1111.2222");
      expect(parsed.text).toBe("Recovery message");
    });

    test("updateMessage calls chat.update", async () => {
      let capturedUrl = "";
      globalThis.fetch = mock(async (url: string) => {
        capturedUrl = url;
        return Response.json({ ok: true, ts: "1111.2222" });
      }) as unknown as typeof fetch;

      const client = new SlackClient({ webhookUrl: "", apiToken: "xoxb-test", channelId: "C123" });
      const ok = await client.updateMessage("1111.2222", [{ type: "section" }]);

      expect(ok).toBe(true);
      expect(capturedUrl).toContain("chat.update");
    });
  });

  describe("webhook fallback", () => {
    test("postAlert returns null in webhook mode", async () => {
      globalThis.fetch = mock(async () => new Response("ok")) as unknown as typeof fetch;

      const client = new SlackClient({ webhookUrl: "https://hooks.slack.com/test" });
      const ts = await client.postAlert([{ type: "section" }]);
      expect(ts).toBeNull();
    });

    test("postThreadReply returns null in webhook mode", async () => {
      const client = new SlackClient({ webhookUrl: "https://hooks.slack.com/test" });
      const ts = await client.postThreadReply("1111.2222", "test");
      expect(ts).toBeNull();
    });

    test("updateMessage returns false in webhook mode", async () => {
      const client = new SlackClient({ webhookUrl: "https://hooks.slack.com/test" });
      const ok = await client.updateMessage("1111.2222", []);
      expect(ok).toBe(false);
    });
  });

  describe("silent mode (no token, no webhook)", () => {
    test("sendAlert returns null silently", async () => {
      const client = new SlackClient({ webhookUrl: "" });
      const ts = await client.sendAlert({
        severity: "warn",
        title: "Test",
        service: "indexer",
        details: "test details",
      });
      expect(ts).toBeNull();
    });

    test("sendDailySummary returns false", async () => {
      const client = new SlackClient({ webhookUrl: "" });
      const ok = await client.sendDailySummary(null, []);
      expect(ok).toBe(false);
    });
  });
});

describe("buildAlertBlocks", () => {
  test("includes header, service, severity, details", () => {
    const blocks = buildAlertBlocks({
      severity: "error",
      title: "OOM Kill",
      service: "indexer",
      details: "Out of memory",
    });

    expect(blocks.length).toBeGreaterThanOrEqual(3);
    expect((blocks[0] as { type: string }).type).toBe("header");
  });

  test("includes action and outcome when provided", () => {
    const blocks = buildAlertBlocks({
      severity: "warn",
      title: "Test",
      service: "api",
      details: "test",
      action: "restart_service",
      outcome: "success",
    });

    expect(blocks.length).toBeGreaterThanOrEqual(4);
  });

  test("includes runbook when commands provided", () => {
    const blocks = buildAlertBlocks({
      severity: "info",
      title: "Test",
      service: "api",
      details: "test",
      commands: ["docker restart api"],
    });

    const lastBlock = blocks[blocks.length - 1] as { type: string; text: { text: string } };
    expect(lastBlock.text.text).toContain("docker restart api");
  });
});
