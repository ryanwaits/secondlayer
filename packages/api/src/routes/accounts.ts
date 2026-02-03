import { Hono } from "hono";
import { getDb } from "@secondlayer/shared/db";
import { getAccountById } from "@secondlayer/shared/db/queries/accounts";
import { checkLimits } from "@secondlayer/shared/db/queries/usage";
import { AuthenticationError } from "@secondlayer/shared/errors";

const app = new Hono();

function requireAccountId(c: any): string {
  const accountId = c.get("accountId") as string | undefined;
  if (!accountId) throw new AuthenticationError("Not authenticated");
  return accountId;
}

// GET /api/accounts/me
app.get("/me", async (c) => {
  const accountId = requireAccountId(c);
  const db = getDb();
  const account = await getAccountById(db, accountId);
  if (!account) throw new AuthenticationError("Account not found");

  return c.json({
    id: account.id,
    email: account.email,
    plan: account.plan,
    createdAt: account.created_at.toISOString(),
  });
});

// GET /api/accounts/usage
app.get("/usage", async (c) => {
  const accountId = requireAccountId(c);
  const db = getDb();
  const account = await getAccountById(db, accountId);
  if (!account) throw new AuthenticationError("Account not found");

  const result = await checkLimits(db, accountId, account.plan);

  return c.json({
    plan: account.plan,
    limits: result.limits,
    current: {
      streams: result.current.streams,
      views: result.current.views,
      apiRequestsToday: result.current.apiRequestsToday,
      deliveriesThisMonth: result.current.deliveriesThisMonth,
      storageBytes: result.current.storageBytes,
    },
  });
});

export default app;
