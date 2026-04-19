import type { Command } from "commander";
import { loadConfig, saveConfig } from "../lib/config.ts";
import { dim, error, success } from "../lib/output.ts";

/**
 * `sl instance connect <url> --key <key>` — points the CLI at a
 * dedicated-hosting instance (e.g. `https://abc12345.secondlayer.tools`)
 * and stores the service key locally.
 *
 * After `connect`, normal commands (`sl subgraphs deploy`, etc.) target
 * this instance instead of the hosted platform default.
 */
export function registerInstanceCommand(program: Command): void {
	const instance = program
		.command("instance")
		.description("Manage connection to a dedicated Secondlayer instance");

	instance
		.command("connect <url>")
		.description("Point the CLI at a dedicated instance")
		.requiredOption(
			"-k, --key <key>",
			"Service key (starts with sl_svc_) — shown in dashboard after provisioning",
		)
		.action(async (url: string, opts: { key: string }) => {
			const cleanUrl = url.replace(/\/$/, "");
			if (!/^https?:\/\//.test(cleanUrl)) {
				error("URL must start with https:// or http://");
				process.exit(1);
			}

			// Ping the instance before saving to catch URL/key typos.
			try {
				const res = await fetch(`${cleanUrl}/api/subgraphs`, {
					headers: { Authorization: `Bearer ${opts.key}` },
				});
				if (!res.ok && res.status !== 200) {
					if (res.status === 401 || res.status === 403) {
						error(`Instance rejected the key (HTTP ${res.status})`);
					} else {
						error(`Instance returned HTTP ${res.status}`);
					}
					process.exit(1);
				}
			} catch (e) {
				error(
					`Could not reach ${cleanUrl}: ${e instanceof Error ? e.message : String(e)}`,
				);
				process.exit(1);
			}

			const config = await loadConfig();
			config.apiUrl = cleanUrl;
			config.apiKey = opts.key;
			await saveConfig(config);

			success(`Connected to ${cleanUrl}`);
			console.log(
				dim("Subsequent commands (sl subgraphs, ...) use this instance."),
			);
			console.log(
				dim("To revert to the hosted platform: sl config unset apiUrl apiKey"),
			);
		});

	instance
		.command("status")
		.description("Show the currently connected instance URL + key prefix")
		.action(async () => {
			const config = await loadConfig();
			if (!config.apiUrl) {
				console.log(dim("Not connected — using the default hosted platform."));
				return;
			}
			console.log(`URL: ${config.apiUrl}`);
			console.log(
				`Key: ${config.apiKey ? `${config.apiKey.slice(0, 10)}…` : "(not set)"}`,
			);
		});

	instance
		.command("disconnect")
		.description("Forget the dedicated-instance URL + key")
		.action(async () => {
			const config = await loadConfig();
			if (!config.apiUrl && !config.apiKey) {
				console.log(dim("No instance connection to forget."));
				return;
			}
			config.apiUrl = undefined;
			config.apiKey = undefined;
			await saveConfig(config);
			success("Disconnected — reverted to the hosted platform.");
		});
}
