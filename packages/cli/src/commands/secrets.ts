import { input, password } from "@inquirer/prompts";
import type { Command } from "commander";
import { assertOk } from "../lib/api-client.ts";
import {
	dim,
	error,
	formatKeyValue,
	formatTable,
	success,
} from "../lib/output.ts";
import { resolveActiveTenant } from "../lib/resolve-tenant.ts";

export function registerSecretsCommand(program: Command): void {
	const secrets = program
		.command("secrets")
		.description(
			"Manage workflow signer secrets (HMAC shared secrets for Remote Signer)",
		);

	secrets
		.command("list")
		.description("List secret names for the authenticated account")
		.action(async () => {
			const { apiUrl, headers } = await apiContext();
			const res = await fetch(`${apiUrl}/api/secrets`, { headers });
			await assertOk(res);
			const { secrets: rows } = (await res.json()) as {
				secrets: Array<{ name: string; createdAt: string; updatedAt: string }>;
			};
			if (rows.length === 0) {
				dim("No secrets set. Add one with: sl secrets set <name> <value>");
				return;
			}
			const table = formatTable(
				["Name", "Created", "Updated"],
				rows.map((r) => [
					r.name,
					new Date(r.createdAt).toLocaleString(),
					new Date(r.updatedAt).toLocaleString(),
				]),
			);
			console.log(table);
		});

	secrets
		.command("set <name> [value]")
		.description(
			"Set or rotate a secret. If value is omitted, reads from stdin prompt.",
		)
		.action(async (name: string, value: string | undefined) => {
			const resolved =
				value ??
				(await password({ message: `Value for "${name}":`, mask: true }));
			if (!resolved) {
				error("Value cannot be empty");
				process.exit(1);
			}
			const { apiUrl, headers } = await apiContext();
			const res = await fetch(
				`${apiUrl}/api/secrets/${encodeURIComponent(name)}`,
				{
					method: "PUT",
					headers: { ...headers, "Content-Type": "application/json" },
					body: JSON.stringify({ value: resolved }),
				},
			);
			await assertOk(res);
			success(`Secret "${name}" set`);
			console.log(
				formatKeyValue([
					["name", name],
					["action", "upsert"],
				]),
			);
		});

	secrets
		.command("rotate <name>")
		.description("Rotate a secret (prompts for new value, replaces existing)")
		.action(async (name: string) => {
			const next = await password({
				message: `New value for "${name}":`,
				mask: true,
			});
			if (!next) {
				error("Value cannot be empty");
				process.exit(1);
			}
			const confirmed = await input({
				message: `Type "${name}" to confirm rotation:`,
			});
			if (confirmed !== name) {
				error("Confirmation mismatch — aborting");
				process.exit(1);
			}
			const { apiUrl, headers } = await apiContext();
			const res = await fetch(
				`${apiUrl}/api/secrets/${encodeURIComponent(name)}`,
				{
					method: "PUT",
					headers: { ...headers, "Content-Type": "application/json" },
					body: JSON.stringify({ value: next }),
				},
			);
			await assertOk(res);
			success(`Secret "${name}" rotated`);
			dim("Workflows using this secret will pick it up within 5 minutes.");
		});

	secrets
		.command("delete <name>")
		.description("Delete a secret")
		.action(async (name: string) => {
			const confirmed = await input({
				message: `Type "${name}" to confirm deletion:`,
			});
			if (confirmed !== name) {
				error("Confirmation mismatch — aborting");
				process.exit(1);
			}
			const { apiUrl, headers } = await apiContext();
			const res = await fetch(
				`${apiUrl}/api/secrets/${encodeURIComponent(name)}`,
				{ method: "DELETE", headers },
			);
			await assertOk(res);
			success(`Secret "${name}" deleted`);
		});
}

async function apiContext(): Promise<{
	apiUrl: string;
	headers: Record<string, string>;
}> {
	const { apiUrl, ephemeralKey } = await resolveActiveTenant();
	return {
		apiUrl,
		headers: {
			authorization: `Bearer ${ephemeralKey}`,
			"content-type": "application/json",
		},
	};
}
