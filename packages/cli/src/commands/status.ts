import type { Command } from "commander";
import { httpPlatformAnon } from "../lib/http.ts";
import { blue, dim, green, output, red, yellow } from "../lib/output.ts";
import { resolveApiUrl } from "../lib/resolve-auth.ts";

export function registerStatusCommand(program: Command): void {
	program
		.command("status")
		.description("Show local instance status")
		.option("--json", "Output as JSON")
		.action(async (options: { json?: boolean }) => {
			try {
				const status =
					await httpPlatformAnon<Record<string, unknown>>("/public/status");
				output({
					json: options.json,
					data: status,
					human: () => printPublicStatus(status),
				});
			} catch {
				console.log("");
				console.log(blue("System Status"));
				console.log(`  ${red("NOT RUNNING")}`);
				console.log("");
				console.log(dim(`  Can't reach ${resolveApiUrl()}/public/status.`));
				console.log(dim("  Start with: docker compose up -d"));
				console.log("");
				process.exit(1);
			}
		});
}

function printPublicStatus(status: Record<string, unknown>): void {
	const overall = String(status.status ?? "unknown");
	const color = overall === "healthy" ? green : red;
	console.log("");
	console.log(blue("System Status"));
	console.log(`  ${color(overall.toUpperCase())}`);
	console.log("");
	const tip = status.chainTip;
	if (typeof tip === "number") {
		console.log(blue("Chain"));
		console.log(`  tip: ${tip.toLocaleString()}`);
		const integrity = status.chainIntegrity as { ok?: boolean } | undefined;
		if (integrity) {
			console.log(
				`  integrity: ${integrity.ok ? green("ok") : yellow("check")}`,
			);
		}
		console.log("");
	}
	const streams = status.streams as
		| { status?: string; tip?: { lag_seconds?: number } }
		| undefined;
	if (streams) {
		console.log(blue("Streams"));
		console.log(`  ${streams.status ?? "unknown"}`);
		if (typeof streams.tip?.lag_seconds === "number") {
			console.log(`  lag: ${streams.tip.lag_seconds}s`);
		}
		console.log("");
	}
	const index = status.index as
		| { status?: string; decoders?: Array<{ decoder: string; status: string }> }
		| undefined;
	if (index) {
		console.log(blue("Index"));
		console.log(`  ${index.status ?? "unknown"}`);
		const bad = (index.decoders ?? []).filter((d) => d.status !== "ok");
		if (bad.length > 0) {
			for (const d of bad.slice(0, 8)) {
				console.log(`  ${yellow(d.decoder)} ${d.status}`);
			}
		}
		console.log("");
	}
	if (typeof status.timestamp === "string") {
		console.log(dim(`Last updated: ${status.timestamp}`));
	}
}
