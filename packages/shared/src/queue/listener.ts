import postgres from "postgres";

const CHANNEL_NEW_JOB = "streams:new_job";

/**
 * Listen for notifications on a channel
 * Uses a dedicated connection for LISTEN
 */
export async function listen(
  channel: string,
  callback: (payload?: string) => void
): Promise<() => Promise<void>> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  // Each listener gets its own connection
  const client = postgres(connectionString, {
    max: 1,
    onnotice: () => {}, // Ignore notices
  });

  await client.listen(channel, (payload) => {
    callback(payload);
  });

  // Return cleanup function
  return async () => {
    await client.end();
  };
}

/**
 * Send a notification on a channel
 */
export async function notify(
  channel: string,
  payload?: string
): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const client = postgres(connectionString, { max: 1 });

  try {
    if (payload) {
      await client`SELECT pg_notify(${channel}, ${payload})`;
    } else {
      await client`SELECT pg_notify(${channel}, '')`;
    }
  } finally {
    await client.end();
  }
}

/**
 * Listen for new job notifications
 * Convenience wrapper for the common use case
 */
export async function listenForJobs(
  callback: (payload?: string) => void
): Promise<() => Promise<void>> {
  return listen(CHANNEL_NEW_JOB, callback);
}

/**
 * Notify workers about new jobs
 */
export async function notifyNewJob(streamId?: string): Promise<void> {
  return notify(CHANNEL_NEW_JOB, streamId);
}

export { CHANNEL_NEW_JOB };
