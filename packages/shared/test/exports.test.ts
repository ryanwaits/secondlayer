import { describe, test, expect } from "bun:test";

describe("package exports", () => {
  test("main export", async () => {
    const mod = await import("@secondlayer/shared");
    expect(mod).toBeDefined();
  });

  test("db export", async () => {
    const mod = await import("@secondlayer/shared/db");
    expect(mod).toBeDefined();
    expect(mod.getDb).toBeDefined();
  });

  test("db/queries/integrity export", async () => {
    const mod = await import("@secondlayer/shared/db/queries/integrity");
    expect(mod).toBeDefined();
  });

  test("db/queries/metrics export", async () => {
    const mod = await import("@secondlayer/shared/db/queries/metrics");
    expect(mod).toBeDefined();
  });

  test("db/queries/accounts export", async () => {
    const mod = await import("@secondlayer/shared/db/queries/accounts");
    expect(mod).toBeDefined();
  });

  test("db/queries/usage export", async () => {
    const mod = await import("@secondlayer/shared/db/queries/usage");
    expect(mod).toBeDefined();
  });

  test("db/queries/views export", async () => {
    const mod = await import("@secondlayer/shared/db/queries/views");
    expect(mod).toBeDefined();
  });

  test("db/jsonb export", async () => {
    const mod = await import("@secondlayer/shared/db/jsonb");
    expect(mod).toBeDefined();
    expect(mod.jsonb).toBeDefined();
  });

  test("db/schema export", async () => {
    const mod = await import("@secondlayer/shared/db/schema");
    expect(mod).toBeDefined();
  });

  test("lib/plans export", async () => {
    const mod = await import("@secondlayer/shared/lib/plans");
    expect(mod).toBeDefined();
  });

  test("queue export", async () => {
    const mod = await import("@secondlayer/shared/queue");
    expect(mod).toBeDefined();
  });

  test("queue/listener export", async () => {
    const mod = await import("@secondlayer/shared/queue/listener");
    expect(mod).toBeDefined();
  });

  test("queue/recovery export", async () => {
    const mod = await import("@secondlayer/shared/queue/recovery");
    expect(mod).toBeDefined();
  });

  test("schemas export", async () => {
    const mod = await import("@secondlayer/shared/schemas");
    expect(mod).toBeDefined();
  });

  test("schemas/filters export", async () => {
    const mod = await import("@secondlayer/shared/schemas/filters");
    expect(mod).toBeDefined();
  });

  test("schemas/views export", async () => {
    const mod = await import("@secondlayer/shared/schemas/views");
    expect(mod).toBeDefined();
  });

  test("types export", async () => {
    const mod = await import("@secondlayer/shared/types");
    expect(mod).toBeDefined();
  });

  test("env export", async () => {
    const mod = await import("@secondlayer/shared/env");
    expect(mod).toBeDefined();
    expect(mod.getEnv).toBeDefined();
  });

  test("logger export", async () => {
    const mod = await import("@secondlayer/shared/logger");
    expect(mod).toBeDefined();
    expect(mod.logger).toBeDefined();
  });

  test("errors export", async () => {
    const mod = await import("@secondlayer/shared/errors");
    expect(mod).toBeDefined();
  });

  test("crypto export", async () => {
    const mod = await import("@secondlayer/shared/crypto");
    expect(mod).toBeDefined();
  });

  test("crypto/hmac export", async () => {
    const mod = await import("@secondlayer/shared/crypto/hmac");
    expect(mod).toBeDefined();
    expect(mod.signPayload).toBeDefined();
  });

  test("node export", async () => {
    const mod = await import("@secondlayer/shared/node");
    expect(mod).toBeDefined();
    expect(mod.StacksNodeClient).toBeDefined();
  });

  test("node/hiro-client export", async () => {
    const mod = await import("@secondlayer/shared/node/hiro-client");
    expect(mod).toBeDefined();
  });
});
