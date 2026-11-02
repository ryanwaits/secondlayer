import { resolveApiKey } from "@secondlayer/sdk";
import type { Command } from "commander";
import { resolveApiUrl, resolveArchiveOpsUrl } from "../lib/api-url.ts";
import {
	ARCHIVE_AUTH_HINT,
	httpArchiveOps,
	resolveArchiveOpsBearer,
} from "../lib/http.ts";
import { formatKeyValue, note, output } from "../lib/output.ts";

export type WhoamiResult = {
	instance: {
		url: string;
		credential: "INSTANCE_TOKEN";
		status: "set" | "missing";
	};
	merchant: {
		url: string;
		credential: "SECONDLAYER_API_KEY" | "session" | null;
		status: "set" | "missing";
		email: string | null;
	};
};

/**
 * Instance + merchant targets. Merchant identity is best-effort: a missing
 * login does not fail the command (self-host default is instance-only).
 */
export async function runWhoami(): Promise<WhoamiResult> {
	const instanceUrl = resolveApiUrl();
	const merchantUrl = resolveArchiveOpsUrl();
	const instanceSet = resolveApiKey() !== undefined;

	const { source } = await resolveArchiveOpsBearer();
	let email: string | null = null;
	let merchantOk = false;
	try {
		const account = await httpArchiveOps<{ email: string }>("/api/accounts/me");
		email = account.email;
		merchantOk = true;
	} catch {
		merchantOk = false;
	}

	const merchantCredential =
		source === "env"
			? "SECONDLAYER_API_KEY"
			: source === "session"
				? "session"
				: null;

	return {
		instance: {
			url: instanceUrl,
			credential: "INSTANCE_TOKEN",
			status: instanceSet ? "set" : "missing",
		},
		merchant: {
			url: merchantUrl,
			credential: merchantCredential,
			status: merchantOk ? "set" : "missing",
			email,
		},
	};
}

/**
 * `whoami` shows which instance and merchant targets the CLI will hit.
 */
export function registerWhoamiCommand(program: Command): void {
	program
		.command("whoami")
		.description("Show instance and merchant targets.")
		.option("--json", "Output as JSON")
		.action(async (options: { json?: boolean }) => {
			const result = await runWhoami();

			output({
				json: options.json,
				data: result,
				human: () => {
					const rows: [string, string][] = [];
					rows.push([
						"instance",
						`${result.instance.url}  ${result.instance.credential}  ${result.instance.status}`,
					]);
					const merchantCred =
						result.merchant.credential ?? "SECONDLAYER_API_KEY|session";
					const merchantValue = result.merchant.email
						? `${result.merchant.url}  ${merchantCred}  ${result.merchant.status}  (${result.merchant.email})`
						: `${result.merchant.url}  ${merchantCred}  ${result.merchant.status}`;
					rows.push(["merchant", merchantValue]);
					console.log(formatKeyValue(rows));
					if (result.merchant.status === "missing") {
						note(`merchant identity missing. ${ARCHIVE_AUTH_HINT}`);
					}
				},
			});
		});
}
