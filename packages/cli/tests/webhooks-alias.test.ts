import { describe, expect, it } from "bun:test";
import { join } from "node:path";

async function runCli(
	args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(
		[process.execPath, "run", join(import.meta.dir, "../src/cli.ts"), ...args],
		{
			cwd: join(import.meta.dir, ".."),
			env: { ...process.env, SL_API_URL: "http://127.0.0.1:1" },
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { exitCode, stdout, stderr };
}

describe("webhooks command aliases", () => {
	it("webhooks list --help parses under the new verb", async () => {
		const { exitCode, stdout, stderr } = await runCli([
			"webhooks",
			"list",
			"--help",
		]);
		expect(exitCode).toBe(0);
		expect(stdout + stderr).toMatch(/List webhooks/);
	});

	it("subscriptions list is unknown", async () => {
		const { exitCode, stderr } = await runCli(["subscriptions", "list"]);
		expect(exitCode).not.toBe(0);
		expect(stderr).not.toMatch(/deprecated; use secondlayer webhooks/);
	});

	it("root --help lists webhooks, not subscriptions", async () => {
		const { exitCode, stdout, stderr } = await runCli(["--help"]);
		expect(exitCode).toBe(0);
		const text = stdout + stderr;
		expect(text).toMatch(/\bwebhooks\b/);
		expect(text).not.toMatch(/\bsubscriptions\b/);
	});
});
