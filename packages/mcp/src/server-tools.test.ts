import { afterEach, describe, expect, it } from "bun:test";
import { isHostedArchiveUrl } from "./lib/hosted.ts";

const SRC = import.meta.dir;

async function createServerToolNames(
	env: Record<string, string | undefined>,
): Promise<string[]> {
	const childEnv: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (
			value !== undefined &&
			key !== "SECONDLAYER_API_URL" &&
			key !== "SL_API_URL"
		) {
			childEnv[key] = value;
		}
	}
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined) childEnv[key] = value;
	}

	const proc = Bun.spawn(
		[
			"bun",
			"-e",
			`import { createServer } from ${JSON.stringify(`${SRC}/server.ts`)};
import { getRegisteredToolNames } from ${JSON.stringify(`${SRC}/lib/tool.ts`)};
createServer();
process.stdout.write(JSON.stringify(getRegisteredToolNames()));`,
		],
		{ env: childEnv, stdout: "pipe", stderr: "pipe" },
	);
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) {
		throw new Error(`createServer child failed (${code}): ${stderr || stdout}`);
	}
	return JSON.parse(stdout) as string[];
}

const originalArchive = process.env.SECONDLAYER_API_URL;
const originalApiUrl = process.env.SL_API_URL;

afterEach(() => {
	if (originalArchive === undefined) delete process.env.SECONDLAYER_API_URL;
	else process.env.SECONDLAYER_API_URL = originalArchive;
	if (originalApiUrl === undefined) delete process.env.SL_API_URL;
	else process.env.SL_API_URL = originalApiUrl;
});

describe("isHostedArchiveUrl", () => {
	it("is true for the hosted archive hostname", () => {
		expect(isHostedArchiveUrl("https://api.secondlayer.tools")).toBe(true);
		expect(isHostedArchiveUrl("https://api.secondlayer.tools/v1")).toBe(true);
	});

	it("is false for loopback", () => {
		expect(isHostedArchiveUrl("http://127.0.0.1:3800")).toBe(false);
		expect(isHostedArchiveUrl("http://localhost:3800")).toBe(false);
	});

	it("is false for garbage", () => {
		expect(isHostedArchiveUrl("not a url")).toBe(false);
		expect(isHostedArchiveUrl("")).toBe(false);
	});
});

describe("createServer account tools", () => {
	it("omits account tools on the default loopback base", async () => {
		const names = await createServerToolNames({});
		expect(names).not.toContain("account_whoami");
		expect(names).not.toContain("account_create_key");
	});

	it("registers account tools when pointed at the hosted archive", async () => {
		const names = await createServerToolNames({
			SECONDLAYER_API_URL: "https://api.secondlayer.tools",
		});
		expect(names).toContain("account_whoami");
		expect(names).toContain("account_create_key");
	});
});
