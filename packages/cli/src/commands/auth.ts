import { Command } from "commander";
import { loadConfig, saveConfig, resolveApiUrl } from "../lib/config.ts";
import { authHeaders } from "../lib/api-client.ts";
import { error, success, dim, formatKeyValue } from "../lib/output.ts";

export function registerAuthCommand(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage authentication and API keys");

  auth
    .command("login")
    .description("Login with email via magic link")
    .action(async () => {
      const config = await loadConfig();
      const apiUrl = resolveApiUrl(config);

      if (!apiUrl) {
        error("No API URL configured. Set network with: sl config set network testnet");
        process.exit(1);
      }

      // Prompt for email
      process.stdout.write("Email: ");
      const email = await readLine();
      if (!email) {
        error("Email is required");
        process.exit(1);
      }

      try {
        // Request magic link
        const mlRes = await fetch(`${apiUrl}/api/auth/magic-link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });

        if (!mlRes.ok) {
          const body = await mlRes.text();
          let msg = `HTTP ${mlRes.status}`;
          try { msg = JSON.parse(body).error || msg; } catch {}
          throw new Error(msg);
        }

        console.log(dim("Check your email for a login token."));
        process.stdout.write("Token: ");
        const token = await readLine();
        if (!token) {
          error("Token is required");
          process.exit(1);
        }

        // Verify token → session
        const verifyRes = await fetch(`${apiUrl}/api/auth/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token.trim() }),
        });

        if (!verifyRes.ok) {
          const body = await verifyRes.text();
          let msg = `HTTP ${verifyRes.status}`;
          try { msg = JSON.parse(body).error || msg; } catch {}
          throw new Error(msg);
        }

        const result = await verifyRes.json() as {
          sessionToken: string;
          account: { id: string; email: string; plan: string };
        };

        config.sessionToken = result.sessionToken;
        await saveConfig(config);

        success(`Authenticated as ${result.account.email}`);
        console.log(dim(`Plan: ${result.account.plan}`));
        console.log(dim(`Network: ${config.network}`));
        console.log(dim(`API: ${apiUrl}`));
      } catch (err) {
        error(`Login failed: ${err}`);
        process.exit(1);
      }
    });

  auth
    .command("logout")
    .description("Revoke session and remove from config")
    .action(async () => {
      const config = await loadConfig();
      const apiUrl = resolveApiUrl(config);

      if (!config.sessionToken) {
        error("Not logged in.");
        process.exit(1);
      }

      try {
        await fetch(`${apiUrl}/api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.sessionToken}` },
        });
      } catch {
        // Best-effort server revoke; clear locally regardless
      }

      delete (config as Record<string, unknown>).sessionToken;
      await saveConfig(config);
      success("Logged out. Session revoked.");
    });

  auth
    .command("status")
    .description("Show current auth status")
    .action(async () => {
      const config = await loadConfig();
      const apiUrl = resolveApiUrl(config);
      const token = config.sessionToken ?? config.apiKey;

      const pairs: [string, string][] = [
        ["Network", config.network],
        ["API", apiUrl || "(not configured)"],
        ["Session", config.sessionToken ? config.sessionToken.slice(0, 14) + "..." : "(none)"],
        ["API Key", config.apiKey ? config.apiKey.slice(0, 14) + "..." : "(none)"],
      ];

      if (token && apiUrl) {
        try {
          const res = await fetch(`${apiUrl}/api/accounts/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json() as { email: string; plan: string };
            pairs.push(["Email", data.email]);
            pairs.push(["Plan", data.plan]);
          }
        } catch {}
      }

      console.log(formatKeyValue(pairs));
    });

  // Key management subcommands
  const keys = auth
    .command("keys")
    .description("Manage API keys");

  keys
    .command("list")
    .description("List API keys for this account")
    .action(async () => {
      const config = await loadConfig();
      const apiUrl = resolveApiUrl(config);
      const headers = authHeaders(config);

      try {
        const res = await fetch(`${apiUrl}/api/keys`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const { keys: keyList } = await res.json() as {
          keys: { id: string; prefix: string; name: string | null; status: string; lastUsedAt: string | null }[];
        };

        if (keyList.length === 0) {
          console.log(dim("No API keys."));
          return;
        }

        for (const k of keyList) {
          const used = k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : "never";
          console.log(`  ${k.prefix}...  ${k.name ?? "(unnamed)"}  ${k.status}  last used: ${used}`);
        }
      } catch (err) {
        error(`Failed to list keys: ${err}`);
        process.exit(1);
      }
    });

  keys
    .command("create")
    .description("Create a new API key")
    .option("--name <name>", "Name for the API key")
    .action(async (options: { name?: string }) => {
      const config = await loadConfig();
      const apiUrl = resolveApiUrl(config);
      const headers = { ...authHeaders(config), "Content-Type": "application/json" };

      try {
        const res = await fetch(`${apiUrl}/api/keys`, {
          method: "POST",
          headers,
          body: JSON.stringify({ name: options.name }),
        });

        if (!res.ok) {
          const body = await res.text();
          let msg = `HTTP ${res.status}`;
          try { msg = JSON.parse(body).error || msg; } catch {}
          throw new Error(msg);
        }

        const { key, prefix } = await res.json() as { key: string; prefix: string };
        success(`Created API key: ${prefix}...`);
        console.log();
        console.log(`  ${key}`);
        console.log();
        console.log(dim("Save this key — it won't be shown again."));
      } catch (err) {
        error(`Failed to create key: ${err}`);
        process.exit(1);
      }
    });

  keys
    .command("revoke <id>")
    .description("Revoke an API key by ID or prefix")
    .action(async (idOrPrefix: string) => {
      const config = await loadConfig();
      const apiUrl = resolveApiUrl(config);
      const headers = authHeaders(config);

      try {
        // Resolve prefix to ID if needed
        let keyId = idOrPrefix;
        if (!idOrPrefix.includes("-")) {
          // Looks like a prefix, resolve it
          const listRes = await fetch(`${apiUrl}/api/keys`, { headers });
          if (!listRes.ok) throw new Error(`HTTP ${listRes.status}`);
          const { keys: keyList } = await listRes.json() as { keys: { id: string; prefix: string }[] };
          const match = keyList.find((k) => k.prefix.startsWith(idOrPrefix) || k.prefix === idOrPrefix);
          if (!match) {
            error(`No key found matching "${idOrPrefix}"`);
            process.exit(1);
          }
          keyId = match.id;
        }

        const res = await fetch(`${apiUrl}/api/keys/${keyId}`, {
          method: "DELETE",
          headers,
        });

        if (!res.ok) {
          const body = await res.text();
          let msg = `HTTP ${res.status}`;
          try { msg = JSON.parse(body).error || msg; } catch {}
          throw new Error(msg);
        }

        success(`Revoked key ${idOrPrefix}`);
      } catch (err) {
        error(`Failed to revoke key: ${err}`);
        process.exit(1);
      }
    });

  keys
    .command("rotate")
    .description("Revoke current API key and create a new one")
    .option("--name <name>", "Name for the new API key", "cli")
    .action(async (options: { name: string }) => {
      await rotateKey(options);
    });

  // Keep `sl auth rotate` as alias
  auth
    .command("rotate")
    .description("Revoke current API key and create a new one")
    .option("--name <name>", "Name for the new API key", "cli")
    .action(async (options: { name: string }) => {
      await rotateKey(options);
    });
}

async function rotateKey(options: { name: string }): Promise<void> {
  const config = await loadConfig();
  const apiUrl = resolveApiUrl(config);
  const headers = authHeaders(config);

  if (!config.sessionToken && !config.apiKey) {
    error("Not logged in. Run `sl auth login` first.");
    process.exit(1);
  }

  try {
    // If there's a current apiKey, find and revoke it
    if (config.apiKey) {
      const listRes = await fetch(`${apiUrl}/api/keys`, { headers });
      if (listRes.ok) {
        const { keys } = await listRes.json() as { keys: { id: string; prefix: string }[] };
        const currentPrefix = config.apiKey.slice(0, 14);
        const current = keys.find((k) => currentPrefix.startsWith(k.prefix));
        if (current) {
          await fetch(`${apiUrl}/api/keys/${current.id}`, {
            method: "DELETE",
            headers,
          });
          console.log(dim(`Revoked old key: ${current.prefix}...`));
        }
      }
    }

    // Create new key
    const createRes = await fetch(`${apiUrl}/api/keys`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ name: options.name }),
    });

    if (!createRes.ok) {
      const body = await createRes.text();
      let msg = `HTTP ${createRes.status}`;
      try { msg = JSON.parse(body).error || msg; } catch {}
      throw new Error(msg);
    }

    const { key, prefix } = await createRes.json() as { key: string; prefix: string };

    config.apiKey = key;
    await saveConfig(config);

    success(`Rotated to new key ${prefix}...`);
  } catch (err) {
    error(`Rotation failed: ${err}`);
    process.exit(1);
  }
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
      if (data.includes("\n")) {
        process.stdin.removeAllListeners("data");
        process.stdin.pause();
        resolve(data.trim());
      }
    });
    process.stdin.resume();
  });
}
