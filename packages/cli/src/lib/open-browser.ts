import { spawn } from "node:child_process";

/** The command that opens `url` in the default browser on this platform. */
export function browserCommand(
	url: string,
	platform: NodeJS.Platform = process.platform,
): { cmd: string; args: string[] } {
	if (platform === "darwin") return { cmd: "open", args: [url] };
	if (platform === "win32") {
		// The empty title keeps `start` from taking the URL as the window title.
		return { cmd: "cmd", args: ["/c", "start", "", url] };
	}
	return { cmd: "xdg-open", args: [url] };
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
	} catch {
		// ignored on purpose
	}
}
