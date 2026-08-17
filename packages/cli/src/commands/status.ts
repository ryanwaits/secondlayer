import type { Command } from "commander";
import { httpPlatformAnon } from "../lib/http.ts";
import {
	type InstanceDiagnosis,
	type PublicStatus,
	diagnoseInstanceStatus,
} from "../lib/instance-diagnosis.ts";
import {
	blue,
	dim,
	green,
	output,
	red,
	wrapText,
	yellow,
} from "../lib/output.ts";
import { resolveApiUrl } from "../lib/resolve-auth.ts";

export function registerStatusCommand(program: Command): void {
	program
		.command("status")
		.description("Show local instance status")
		.option("--json", "Output as JSON")
		.action(async (options: { json?: boolean }) => {
			try {
				const status = await httpPlatformAnon<PublicStatus>("/public/status");
				const diagnosis = diagnoseInstanceStatus(status);
				output({
					json: options.json,
					// Additive: the raw payload is unchanged, `diagnosis` explains it.
					data: { ...status, diagnosis },
					human: () => printPublicStatus(status, diagnosis),
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

function printPublicStatus(
	status: PublicStatus,
	diagnosis: InstanceDiagnosis,
): void {
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
		const integrity = status.chainIntegrity;
		if (integrity) {
			console.log(
				`  integrity: ${integrity.ok ? green("ok") : yellow("check")}`,
			);
		}
		console.log("");
	}
	const streams = status.streams;
	if (streams) {
		console.log(blue("Streams"));
		console.log(`  ${streams.status ?? "unknown"}`);
		if (typeof streams.tip?.lag_seconds === "number") {
			console.log(`  lag: ${streams.tip.lag_seconds}s`);
		}
		console.log("");
	}
	const index = status.index;
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
	// A degraded verdict is useless without a cause and a next command — the
	// most common one, a fresh instance with no blocks, is not a fault at all.
	if (diagnosis.issues.length > 0) {
		console.log(blue("Diagnosis"));
		for (const issue of diagnosis.issues) {
			console.log(`  ${yellow(issue.title)}`);
			for (const line of issue.detail ? wrapText(issue.detail, 74) : []) {
				console.log(dim(`  ${line}`));
			}
			for (const step of issue.nextSteps) {
				console.log(dim(`    → ${step}`));
			}
		}
		console.log("");
	}
	if (typeof status.timestamp === "string") {
		console.log(dim(`Last updated: ${status.timestamp}`));
	}
}
