import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "@secondlayer/shared/db";
import { InvalidJSONError } from "../middleware/error.ts";

const app = new Hono();

const WaitlistSchema = z.object({
  email: z.string().email(),
  source: z.string().optional(),
});

app.post("/", async (c) => {
  const body = await c.req.json().catch(() => {
    throw new InvalidJSONError();
  });
  const { email, source } = WaitlistSchema.parse(body);
  const db = getDb();

  await db
    .insertInto("waitlist")
    .values({ email, ...(source ? { source } : {}) })
    .onConflict((oc) => oc.column("email").doNothing())
    .execute();

  return c.json({ message: "You're on the list." });
});

export default app;
