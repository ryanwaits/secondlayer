import { spawn } from "node:child_process";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function validateBrowserUrl(url: string): string {
	const parsed = new URL(url);
	if (parsed.protocol === "https:") return parsed.toString();
	if (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname)) {
		return parsed.toString();
	}
	throw new Error(
		`Refusing to open unsupported browser URL: ${parsed.protocol}`,
	);
}

/** The command that opens `url` in the default browser on this platform. */
export function browserCommand(
	url: string,
	platform: NodeJS.Platform = process.platform,
): { cmd: string; args: string[] } {
	const safeUrl = validateBrowserUrl(url);
	if (platform === "darwin") return { cmd: "open", args: [safeUrl] };
	if (platform === "win32") {
		return { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", safeUrl] };
	}
	return { cmd: "xdg-open", args: [safeUrl] };
}

/**
 * Open `url` in the user's browser, detached. Never throws: on a machine with
 * no browser the caller has already printed the URL.
 */
export function openBrowser(url: string): void {
	try {
		const { cmd, args } = browserCommand(url);
		const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
		child.on("error", () => {});
		child.unref();
	} catch {}
}
