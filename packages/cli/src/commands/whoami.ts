import { Command } from "commander";
import { loadConfig, resolveApiUrl } from "../lib/config.ts";
import { authHeaders } from "../lib/api-client.ts";
import { error, formatKeyValue, dim } from "../lib/output.ts";

export function registerWhoamiCommand(program: Command): void {
  program
    .command("whoami")
    .description("Show current authenticated account")
    .action(async () => {
      const config = await loadConfig();
      const apiUrl = resolveApiUrl(config);
      if (!config.apiKey) {
        error("Not authenticated. Run: sl auth login");
        process.exit(1);
      }

      try {
        const res = await fetch(`${apiUrl}/api/accounts/me`, {
          headers: authHeaders(config),
        });

        if (res.status === 401) {
          error("Not authenticated. Run: sl auth login");
          process.exit(1);
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json() as { email: string; plan: string };
        console.log(formatKeyValue([
          ["Email", data.email],
          ["Plan", data.plan],
          ["Network", config.network],
          ["API", dim(apiUrl)],
        ]));
      } catch (err) {
        error(`Failed to fetch account: ${err}`);
        process.exit(1);
      }
    });
}
