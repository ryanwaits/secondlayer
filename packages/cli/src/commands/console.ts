import { spawn } from "node:child_process";
import type { Command } from "commander";
import { printError, success, writeData } from "../lib/output.ts";
import { isOssMode } from "../lib/resolve-auth.ts";

const DEFAULT_CONSOLE_URL = "http://localhost:3801/console";
const CONSOLE_PORT = 3801;

/**
 * Resolve the console URL. `--url` wins; otherwise, when SL_API_URL points at
 * a self-hosted box, the console lives on the same host one port up
 * (3800 → 3801). The hosted platform has no console sibling, so a
 * platform-pointed SL_API_URL falls through to the local default.
 */
export function resolveConsoleUrl(override?: string): string {
	if (override) return override.replace(/\/+$/, "");
	const apiUrl = process.env.SL_API_URL;
	if (apiUrl && isOssMode()) {
		try {
			const { protocol, hostname } = new URL(apiUrl);
			return `${protocol}//${hostname}:${CONSOLE_PORT}/console`;
		} catch {
			// Unparseable SL_API_URL — fall back to the local default.
		}
	}
	return DEFAULT_CONSOLE_URL;
}

async function isReachable(url: string): Promise<boolean> {
	try {
		await fetch(url, { signal: AbortSignal.timeout(2_000) });
		return true;
	} catch {
		return false;
	}
}

/** Launch the platform opener; resolves false when none exists or spawn fails. */
function openBrowser(url: string): Promise<boolean> {
	const opener =
		process.platform === "darwin"
			? "open"
			: process.platform === "linux"
				? "xdg-open"
				: undefined;
	if (!opener) return Promise.resolve(false);
	return new Promise((resolve) => {
		const child = spawn(opener, [url], { stdio: "ignore", detached: true });
		child.once("error", () => resolve(false));
		child.once("spawn", () => {
			child.unref();
			resolve(true);
		});
	});
}

export function registerConsoleCommand(program: Command): void {
	program
		.command("console")
		.description("Open the console UI in a browser")
		.option("--url <url>", `Console URL (default ${DEFAULT_CONSOLE_URL})`)
		.option("--no-open", "Print the console URL instead of opening a browser")
		.action(async (options: { url?: string; open?: boolean }) => {
			const url = resolveConsoleUrl(options.url);
			if (options.open === false) {
				writeData(url);
				return;
			}
			if (!(await isReachable(url))) {
				printError(`Console not reachable at ${url}`, {
					hint: "docker compose --profile console up -d",
				});
				process.exit(1);
			}
			if (await openBrowser(url)) {
				success(`console: ${url}`);
			} else {
				writeData(url);
			}
		});
}
