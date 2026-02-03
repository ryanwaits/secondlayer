import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { getDb, jsonb } from "../src/db/index.ts";
import { sql } from "kysely";
import { enqueue, claim, complete, fail, stats } from "../src/queue/index.ts";
import { recoverStaleJobs } from "../src/queue/recovery.ts";

// Skip tests if no DATABASE_URL
const SKIP = !process.env.DATABASE_URL;

describe.skipIf(SKIP)("Job Queue", () => {
  let testStreamId: string;

  beforeAll(async () => {
    const db = getDb();

    // Create a test stream
    const stream = await db
      .insertInto("streams")
      .values({
        name: "test-stream",
        webhook_url: "https://example.com/webhook",
        filters: jsonb([]) as any,
        options: jsonb({}) as any,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    testStreamId = stream.id;
  });

  beforeEach(async () => {
    const db = getDb();
    await db.deleteFrom("jobs").execute();
  });

  afterAll(async () => {
    const db = getDb();
    await db.deleteFrom("jobs").execute();
    await sql`DELETE FROM streams WHERE id = ${testStreamId}`.execute(db);
  });

  test("enqueue creates pending job", async () => {
    const jobId = await enqueue(testStreamId, 100);
    expect(jobId).toBeDefined();

    const db = getDb();
    const job = await db.selectFrom("jobs").selectAll().where("id", "=", jobId).executeTakeFirst();
    expect(job?.status).toBe("pending");
    expect(Number(job?.block_height)).toBe(100);
    expect(job?.stream_id).toBe(testStreamId);
  });

  test("claim returns job and locks it", async () => {
    await enqueue(testStreamId, 200);

    const job = await claim();
    expect(job).not.toBeNull();
    expect(job?.status).toBe("processing");
    expect(job?.locked_by).toBeDefined();
    expect(Number(job?.block_height)).toBe(200);
  });

  test("claim skips locked jobs", async () => {
    await enqueue(testStreamId, 300);
    await enqueue(testStreamId, 301);

    // First claim
    const job1 = await claim();
    expect(Number(job1?.block_height)).toBe(300);

    // Second claim should get different job
    const job2 = await claim();
    expect(Number(job2?.block_height)).toBe(301);

    // Third claim should return null
    const job3 = await claim();
    expect(job3).toBeNull();
  });

  test("complete marks job completed", async () => {
    const jobId = await enqueue(testStreamId, 400);
    await claim();

    await complete(jobId);

    const db = getDb();
    const job = await db.selectFrom("jobs").selectAll().where("id", "=", jobId).executeTakeFirst();
    expect(job?.status).toBe("completed");
    expect(job?.completed_at).toBeDefined();
    expect(job?.locked_at).toBeNull();
  });

  test("fail increments attempts and re-queues if under max", async () => {
    const jobId = await enqueue(testStreamId, 500);
    await claim();

    await fail(jobId, "test error", 3);

    const db = getDb();
    const job = await db.selectFrom("jobs").selectAll().where("id", "=", jobId).executeTakeFirst();
    expect(job?.status).toBe("pending");
    expect(job?.error).toBe("test error");
    expect(job?.attempts).toBe(1);
  });

  test("fail marks failed if max attempts reached", async () => {
    const jobId = await enqueue(testStreamId, 600);

    // Simulate 3 failed attempts
    await claim();
    await fail(jobId, "error 1", 3);
    await claim();
    await fail(jobId, "error 2", 3);
    await claim();
    await fail(jobId, "error 3", 3);

    const db = getDb();
    const job = await db.selectFrom("jobs").selectAll().where("id", "=", jobId).executeTakeFirst();
    expect(job?.status).toBe("failed");
    expect(job?.attempts).toBe(3);
  });

  test("stats returns correct counts", async () => {
    await enqueue(testStreamId, 700);
    await enqueue(testStreamId, 701);
    const jobId = await enqueue(testStreamId, 702);
    const claimed = await claim();
    await complete(claimed!.id);

    const queueStats = await stats();
    expect(queueStats.pending).toBe(2);
    expect(queueStats.completed).toBe(1);
    expect(queueStats.total).toBe(3);
  });
});

describe.skipIf(SKIP)("Stale Job Recovery", () => {
  let testStreamId: string;

  beforeAll(async () => {
    const db = getDb();

    const stream = await db
      .insertInto("streams")
      .values({
        name: "recovery-test-stream",
        webhook_url: "https://example.com/webhook",
        filters: jsonb([]) as any,
        options: jsonb({}) as any,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    testStreamId = stream.id;
  });

  beforeEach(async () => {
    const db = getDb();
    await db.deleteFrom("jobs").execute();
  });

  afterAll(async () => {
    const db = getDb();
    await db.deleteFrom("jobs").execute();
    await sql`DELETE FROM streams WHERE id = ${testStreamId}`.execute(db);
  });

  test("recovers jobs locked longer than threshold", async () => {
    const db = getDb();

    // Create a job that appears locked long ago
    await db.insertInto("jobs").values({
      stream_id: testStreamId,
      block_height: 800,
      status: "processing",
      locked_at: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
      locked_by: "dead-worker",
    }).execute();

    const recovered = await recoverStaleJobs(5);
    expect(recovered).toBe(1);

    // Verify job is now pending
    const job = await db.selectFrom("jobs").selectAll().where("block_height", "=", 800).executeTakeFirst();
    expect(job?.status).toBe("pending");
    expect(job?.locked_at).toBeNull();
  });

  test("does not recover recently locked jobs", async () => {
    const db = getDb();

    // Create a recently locked job
    await db.insertInto("jobs").values({
      stream_id: testStreamId,
      block_height: 801,
      status: "processing",
      locked_at: new Date(), // Just now
      locked_by: "active-worker",
    }).execute();

    const recovered = await recoverStaleJobs(5);
    expect(recovered).toBe(0);

    // Verify job is still processing
    const job = await db.selectFrom("jobs").selectAll().where("block_height", "=", 801).executeTakeFirst();
    expect(job?.status).toBe("processing");
  });
});
