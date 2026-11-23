import { closeDb } from "@secondlayer/shared/db";
import {
	MAINNET_POX5_CYCLE_PARAMS,
	maintainPox5Cycles,
	readPox5RollupEvents,
} from "./pox5-cycles-storage.ts";
import { rollupPox5Cycles } from "./pox5-cycles.ts";

type Args = { apply: boolean };

function parseArgs(argv: string[]): Args {
	return { apply: argv.includes("--apply") };
}

export async function rebuildPox5Cycles(args: Args): Promise<{
	events: number;
	cycles: number;
	signers: number;
	warnings: number;
	durationMs: number;
	applied: boolean;
}> {
	if (args.apply) {
		const result = await maintainPox5Cycles();
		return { ...result, events: -1, warnings: -1, applied: true };
	}

	const started = performance.now();
	const events = await readPox5RollupEvents();
	const { cycles, signers, warnings } = rollupPox5Cycles(
		events,
		MAINNET_POX5_CYCLE_PARAMS,
	);
	return {
		events: events.length,
		cycles: cycles.length,
		signers: signers.length,
		warnings: warnings.length,
		durationMs: performance.now() - started,
		applied: false,
	};
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	console.log(`[rebuild-pox5-cycles] ${args.apply ? "APPLY" : "dry-run"}`);
	const result = await rebuildPox5Cycles(args);
	console.log(
		`[rebuild-pox5-cycles] cycles ${result.cycles} · signers ${result.signers} · ` +
			`${result.events >= 0 ? `events ${result.events} · ` : ""}` +
			`${result.warnings >= 0 ? `warnings ${result.warnings} · ` : ""}` +
			`${Math.round(result.durationMs)}ms${result.applied ? " (written)" : " (dry-run, nothing written)"}`,
	);
	await closeDb();
}

if (import.meta.main) {
	void main();
}
