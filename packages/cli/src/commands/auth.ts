import { hostname } from "node:os";
import { input } from "@inquirer/prompts";
import type { Command } from "commander";
import { assertOk, authHeaders } from "../lib/api-client.ts";
import { loadConfig, resolveApiUrl, saveConfig } from "../lib/config.ts";
import { dim, error, formatKeyValue, success } from "../lib/output.ts";

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
				error(
					"No API URL configured. Set network with: sl config set network testnet",
				);
				process.exit(1);
			}

			const email = await input({
				message: "Email:",
				validate: (v) => v.includes("@") || "Enter a valid email",
			});

			try {
				// Request magic link
				const mlRes = await fetch(`${apiUrl}/api/auth/magic-link`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ email }),
				});

				await assertOk(mlRes);

				console.log(dim("Check your email for a 6-digit login code."));
				const token = await input({
					message: "Code:",
					validate: (v) => v.trim().length > 0 || "Token is required",
				});

				// Verify token → session
				const verifyRes = await fetch(`${apiUrl}/api/auth/verify`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ token: token.trim() }),
				});

				await assertOk(verifyRes);

				const result = (await verifyRes.json()) as {
					sessionToken: string;
					account: { id: string; email: string; plan: string };
				};

				const sessionHeaders = {
					Authorization: `Bearer ${result.sessionToken}`,
					"Content-Type": "application/json",
				};
				const keyName = `cli-${hostname().toLowerCase()}`;

				// Revoke existing key with same name
				const listRes = await fetch(`${apiUrl}/api/keys`, {
					headers: sessionHeaders,
				});
				if (listRes.ok) {
					const { keys } = (await listRes.json()) as {
						keys: { id: string; name: string | null; status: string }[];
					};
					const existing = keys.find(
						(k) => k.name === keyName && k.status === "active",
					);
					if (existing) {
						await fetch(`${apiUrl}/api/keys/${existing.id}`, {
							method: "DELETE",
							headers: sessionHeaders,
						});
					}
				}

				// Create new API key
				const createRes = await fetch(`${apiUrl}/api/keys`, {
					method: "POST",
					headers: sessionHeaders,
					body: JSON.stringify({ name: keyName }),
				});
				await assertOk(createRes);
				const { key, prefix } = (await createRes.json()) as {
					key: string;
					prefix: string;
				};

				config.apiKey = key;
				await saveConfig(config);

				// Best-effort session cleanup
				try {
					await fetch(`${apiUrl}/api/auth/logout`, {
						method: "POST",
						headers: sessionHeaders,
					});
				} catch {}

				success(`Authenticated as ${result.account.email}`);
				console.log(dim(`Key: ${prefix}...`));
				console.log(dim(`Network: ${config.network}`));
				console.log(dim(`API: ${apiUrl}`));
			} catch (err) {
				error(`Login failed: ${err}`);
				process.exit(1);
			}
		});

	auth
		.command("logout")
		.description("Revoke API key and remove from config")
		.action(async () => {
			const config = await loadConfig();
			const apiUrl = resolveApiUrl(config);

			if (!config.apiKey) {
				error("Not logged in.");
				process.exit(1);
			}

			try {
				const headers = authHeaders(config);
				const listRes = await fetch(`${apiUrl}/api/keys`, { headers });
				if (listRes.ok) {
					const { keys } = (await listRes.json()) as {
						keys: { id: string; prefix: string }[];
					};
					const currentPrefix = config.apiKey.slice(0, 14);
					const match = keys.find((k) => currentPrefix.startsWith(k.prefix));
					if (match) {
						await fetch(`${apiUrl}/api/keys/${match.id}`, {
							method: "DELETE",
							headers,
						});
					}
				}
			} catch {
				// Best-effort server revoke; clear locally regardless
			}

			delete (config as Record<string, unknown>).apiKey;
			await saveConfig(config);
			success("Logged out. API key revoked.");
		});

	auth
		.command("status")
		.description("Show current auth status")
		.action(async () => {
			const config = await loadConfig();
			const apiUrl = resolveApiUrl(config);

			const pairs: [string, string][] = [
				["Network", config.network],
				["API", apiUrl || "(not configured)"],
				[
					"API Key",
					config.apiKey ? config.apiKey.slice(0, 14) + "..." : "(none)",
				],
			];

			if (config.apiKey && apiUrl) {
				try {
					const res = await fetch(`${apiUrl}/api/accounts/me`, {
						headers: authHeaders(config),
					});
					if (res.ok) {
						const data = (await res.json()) as { email: string; plan: string };
						pairs.push(["Email", data.email]);
						pairs.push(["Plan", data.plan]);
					}
				} catch {}
			}

			console.log(formatKeyValue(pairs));
		});

	// Key management subcommands
	const keys = auth.command("keys").description("Manage API keys");

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

				const { keys: keyList } = (await res.json()) as {
					keys: {
						id: string;
						prefix: string;
						name: string | null;
						status: string;
						lastUsedAt: string | null;
					}[];
				};

				if (keyList.length === 0) {
					console.log(dim("No API keys."));
					return;
				}

				for (const k of keyList) {
					const used = k.lastUsedAt
						? new Date(k.lastUsedAt).toLocaleDateString()
						: "never";
					console.log(
						`  ${k.prefix}...  ${k.name ?? "(unnamed)"}  ${k.status}  last used: ${used}`,
					);
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
			const headers = {
				...authHeaders(config),
				"Content-Type": "application/json",
			};

			try {
				const res = await fetch(`${apiUrl}/api/keys`, {
					method: "POST",
					headers,
					body: JSON.stringify({ name: options.name }),
				});

				await assertOk(res);

				const { key, prefix } = (await res.json()) as {
					key: string;
					prefix: string;
				};
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
					const { keys: keyList } = (await listRes.json()) as {
						keys: { id: string; prefix: string }[];
					};
					const match = keyList.find(
						(k) => k.prefix.startsWith(idOrPrefix) || k.prefix === idOrPrefix,
					);
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

				await assertOk(res);

				success(`Revoked key ${idOrPrefix}`);
			} catch (err) {
				error(`Failed to revoke key: ${err}`);
				process.exit(1);
			}
		});

	const defaultKeyName = `cli-${hostname().toLowerCase()}`;

	keys
		.command("rotate")
		.description("Revoke current API key and create a new one")
		.option("--name <name>", "Name for the new API key", defaultKeyName)
		.action(async (options: { name: string }) => {
			await rotateKey(options);
		});

	// Keep `sl auth rotate` as alias
	auth
		.command("rotate")
		.description("Revoke current API key and create a new one")
		.option("--name <name>", "Name for the new API key", defaultKeyName)
		.action(async (options: { name: string }) => {
			await rotateKey(options);
		});
}

async function rotateKey(options: { name: string }): Promise<void> {
	const config = await loadConfig();
	const apiUrl = resolveApiUrl(config);
	const headers = authHeaders(config);

	if (!config.apiKey) {
		error("Not logged in. Run `sl auth login` first.");
		process.exit(1);
	}

	try {
		// If there's a current apiKey, find and revoke it
		if (config.apiKey) {
			const listRes = await fetch(`${apiUrl}/api/keys`, { headers });
			if (listRes.ok) {
				const { keys } = (await listRes.json()) as {
					keys: { id: string; prefix: string }[];
				};
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

		await assertOk(createRes);

		const { key, prefix } = (await createRes.json()) as {
			key: string;
			prefix: string;
		};

		config.apiKey = key;
		await saveConfig(config);

		success(`Rotated to new key ${prefix}...`);
	} catch (err) {
		error(`Rotation failed: ${err}`);
		process.exit(1);
	}
}
