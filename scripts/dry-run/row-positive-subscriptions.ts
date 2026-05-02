import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const SUBGRAPH = "stx-transfers-proof";
const TABLE = "transfers";
const OK_SUBSCRIPTION = "row-positive-ok";
const FAIL_SUBSCRIPTION = "row-positive-fail";
const MIN_ROWS = Number.parseInt(process.env.ROW_POSITIVE_MIN_ROWS ?? "25", 10);
const INITIAL_LOOKBACK = Number.parseInt(
	process.env.ROW_POSITIVE_LOOKBACK ?? "60",
	10,
);
const RETRY_LOOKBACK = Number.parseInt(
	process.env.ROW_POSITIVE_RETRY_LOOKBACK ?? "500",
	10,
);

interface CommandResult {
	stdout: string;
	stderr: string;
}

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}

function cliBase(): string[] {
	const override = process.env.SL_CLI_COMMAND;
	if (override?.trim()) return override.trim().split(/\s+/);
	return ["bunx", "@secondlayer/cli@latest"];
}

async function readSessionToken(): Promise<string | null> {
	try {
		const raw = await readFile(
			join(homedir(), ".secondlayer/session.json"),
			"utf8",
		);
		const parsed = JSON.parse(raw) as { token?: unknown };
		return typeof parsed.token === "string" ? parsed.token : null;
	} catch {
		return null;
	}
}

async function deleteProject(slug: string): Promise<void> {
	const token = await readSessionToken();
	if (!token) {
		console.warn(`Could not delete project ${slug}: no CLI session token`);
		return;
	}
	const apiUrl =
		process.env.SL_PLATFORM_API_URL ?? "https://api.secondlayer.tools";
	const res = await fetch(
		`${apiUrl}/api/projects/${encodeURIComponent(slug)}`,
		{
			method: "DELETE",
			headers: { authorization: `Bearer ${token}` },
		},
	);
	if (res.ok || res.status === 404) {
		console.log(`Project ${slug} deleted`);
		return;
	}
	const body = await res.text().catch(() => "");
	console.warn(`Could not delete project ${slug}: HTTP ${res.status} ${body}`);
}

async function runCli(
	cwd: string,
	args: string[],
	options: { allowFailure?: boolean } = {},
): Promise<CommandResult> {
	const [cmd, ...baseArgs] = cliBase();
	if (!cmd) throw new Error("SL_CLI_COMMAND resolved to an empty command");
	const fullArgs = [...baseArgs, ...args];
	console.log(`$ ${[cmd, ...fullArgs].join(" ")}`);
	const env = { ...process.env };
	if (!env.SL_SERVICE_KEY && env.SL_ROW_ALLOW_ENV_TENANT !== "true") {
		env.SL_API_URL = undefined;
	}

	return new Promise((resolve, reject) => {
		const child = spawn(cmd, fullArgs, {
			cwd,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			const text = String(chunk);
			stdout += text;
			process.stdout.write(text);
		});
		child.stderr.on("data", (chunk) => {
			const text = String(chunk);
			stderr += text;
			process.stderr.write(text);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0 || options.allowFailure) {
				resolve({ stdout, stderr });
				return;
			}
			reject(
				new Error(`Command failed (${code}): ${[cmd, ...fullArgs].join(" ")}`),
			);
		});
	});
}

function parseJson<T>(text: string): T {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	for (let i = lines.length - 1; i >= 0; i -= 1) {
		const line = lines[i];
		if (!line) continue;
		if (!line.startsWith("{") && !line.startsWith("[")) continue;
		try {
			return JSON.parse(lines.slice(i).join("\n")) as T;
		} catch {}
	}
	throw new Error(`No JSON found in output: ${text}`);
}

async function fetchJson<T>(url: string): Promise<T | null> {
	const res = await fetch(url);
	if (!res.ok) return null;
	return (await res.json()) as T;
}

async function getChainTip(): Promise<number> {
	const candidates = [
		process.env.STACKS_NODE_RPC_URL
			? `${process.env.STACKS_NODE_RPC_URL.replace(/\/$/, "")}/v2/info`
			: null,
		process.env.HIRO_API_URL
			? `${process.env.HIRO_API_URL.replace(/\/$/, "")}/extended/v1/status`
			: null,
		"https://api.mainnet.hiro.so/extended/v1/status",
		"https://api.mainnet.hiro.so/v2/info",
	].filter((url): url is string => Boolean(url));

	for (const url of candidates) {
		try {
			const body = await fetchJson<Record<string, unknown>>(url);
			const tip =
				typeof body?.stacks_tip_height === "number"
					? body.stacks_tip_height
					: typeof body?.chain_tip === "object" &&
							body.chain_tip !== null &&
							typeof (body.chain_tip as Record<string, unknown>)
								.block_height === "number"
						? ((body.chain_tip as Record<string, unknown>)
								.block_height as number)
						: 0;
			if (tip > 0) {
				console.log(`Chain tip ${tip} from ${url}`);
				return tip;
			}
		} catch (err) {
			console.warn(
				`Could not read chain tip from ${url}: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
	}
	throw new Error("Could not determine chain tip from Stacks node or Hiro");
}

async function writeFixture(cwd: string): Promise<string> {
	const path = join(cwd, "stx-transfers-proof.ts");
	await writeFile(
		path,
		`export default {
	name: "${SUBGRAPH}",
	version: "1.0.0",
	description: "Deterministic STX transfer proof fixture",
	startBlock: 0,
	sources: {
		transfer: { type: "stx_transfer" },
	},
	schema: {
		${TABLE}: {
			columns: {
				sender: { type: "principal", indexed: true },
				recipient: { type: "principal", indexed: true },
				amount: { type: "uint" },
			},
		},
	},
	handlers: {
		transfer(event, ctx) {
			ctx.insert("${TABLE}", {
				sender: event.sender,
				recipient: event.recipient,
				amount: event.amount,
			});
		},
	},
};
`,
	);
	return path;
}

async function countRows(cwd: string): Promise<number> {
	const result = await runCli(cwd, [
		"subgraphs",
		"query",
		SUBGRAPH,
		TABLE,
		"--count",
		"--json",
	]);
	const parsed = parseJson<{ count: number }>(result.stdout);
	return Number(parsed.count);
}

function looksSynced(statusOutput: string): boolean {
	const normalized = statusOutput.toLowerCase();
	return (
		/\bsynced\b/.test(normalized) &&
		!/catching|reindexing|queued|pending/.test(normalized)
	);
}

async function waitForRows(
	cwd: string,
	startBlock: number,
): Promise<{ count: number; synced: boolean }> {
	const deadline = Date.now() + 10 * 60_000;
	let lastCount = 0;
	let synced = false;
	while (Date.now() < deadline) {
		const status = await runCli(cwd, ["subgraphs", "status", SUBGRAPH], {
			allowFailure: true,
		});
		synced = looksSynced(status.stdout);
		try {
			lastCount = await countRows(cwd);
			console.log(
				`Rows indexed from ${startBlock}: ${lastCount}; synced=${synced}`,
			);
			if (lastCount >= MIN_ROWS && synced) return { count: lastCount, synced };
		} catch (err) {
			console.warn(
				`Count not ready: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 15_000));
	}
	return { count: lastCount, synced };
}

async function deployFixture(
	cwd: string,
	fixturePath: string,
	startBlock: number,
): Promise<void> {
	await runCli(cwd, [
		"subgraphs",
		"deploy",
		fixturePath,
		"--start-block",
		String(startBlock),
		"--force",
	]);
}

async function recentDeliveries(
	cwd: string,
	subscription: string,
): Promise<Array<{ statusCode: number | null }>> {
	const result = await runCli(cwd, [
		"subscriptions",
		"deliveries",
		subscription,
		"--json",
	]);
	return parseJson<Array<{ statusCode: number | null }>>(result.stdout);
}

async function assertSuccessfulDelivery(cwd: string): Promise<void> {
	const deadline = Date.now() + 2 * 60_000;
	while (Date.now() < deadline) {
		const deliveries = await recentDeliveries(cwd, OK_SUBSCRIPTION);
		if (
			deliveries.some(
				(row) =>
					row.statusCode !== null &&
					row.statusCode >= 200 &&
					row.statusCode < 300,
			)
		) {
			console.log("Positive subscription has a 2xx delivery");
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 5_000));
	}
	throw new Error("Positive subscription did not produce a 2xx delivery");
}

async function waitForOpenCircuit(cwd: string): Promise<void> {
	const deadline = Date.now() + 3 * 60_000;
	while (Date.now() < deadline) {
		const result = await runCli(cwd, [
			"subscriptions",
			"get",
			FAIL_SUBSCRIPTION,
			"--json",
		]);
		const sub = parseJson<{
			status: string;
			circuitFailures: number;
			circuitOpenedAt: string | null;
		}>(result.stdout);
		if (
			sub.status === "paused" &&
			sub.circuitFailures >= 20 &&
			sub.circuitOpenedAt
		) {
			console.log(
				`Failing subscription circuit opened after ${sub.circuitFailures} failures`,
			);
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 5_000));
	}
	throw new Error("Failing subscription circuit did not open");
}

async function main(): Promise<void> {
	const okWebhookUrl = requireEnv("OK_WEBHOOK_URL");
	const failWebhookUrl = requireEnv("FAIL_WEBHOOK_URL");
	const cwd = await mkdtemp(join(tmpdir(), "secondlayer-row-proof-"));
	const projectSlug = `row-positive-${Date.now().toString(36)}`;
	let instanceCreated = false;
	let okSubscriptionCreated = false;
	let failSubscriptionCreated = false;
	let subgraphCreated = false;

	console.log(`Working directory: ${cwd}`);

	try {
		const tip = await getChainTip();
		const fixture = await writeFixture(cwd);

		await runCli(cwd, [
			"project",
			"create",
			"Row Positive Proof",
			"--slug",
			projectSlug,
		]);
		await runCli(cwd, ["project", "use", projectSlug]);
		await runCli(cwd, ["instance", "create", "--plan", "hobby"]);
		instanceCreated = true;

		let startBlock = Math.max(0, tip - INITIAL_LOOKBACK);
		await deployFixture(cwd, fixture, startBlock);
		subgraphCreated = true;
		let indexed = await waitForRows(cwd, startBlock);

		if (indexed.count < MIN_ROWS) {
			startBlock = Math.max(0, tip - RETRY_LOOKBACK);
			console.warn(
				`Only ${indexed.count} rows found; retrying from block ${startBlock}`,
			);
			await deployFixture(cwd, fixture, startBlock);
			indexed = await waitForRows(cwd, startBlock);
		}

		if (indexed.count < MIN_ROWS) {
			throw new Error(
				`${SUBGRAPH}.${TABLE} only indexed ${indexed.count} rows; expected at least ${MIN_ROWS}`,
			);
		}
		if (!indexed.synced) {
			throw new Error(`${SUBGRAPH} did not report synced before timeout`);
		}

		await runCli(cwd, [
			"create",
			"subscription",
			OK_SUBSCRIPTION,
			"--runtime",
			"node",
			"--subgraph",
			SUBGRAPH,
			"--table",
			TABLE,
			"--url",
			okWebhookUrl,
		]);
		okSubscriptionCreated = true;
		await runCli(cwd, [
			"subscriptions",
			"replay",
			OK_SUBSCRIPTION,
			"--from-block",
			String(startBlock),
			"--to-block",
			String(tip),
			"--yes",
		]);
		await assertSuccessfulDelivery(cwd);

		await runCli(cwd, [
			"create",
			"subscription",
			FAIL_SUBSCRIPTION,
			"--runtime",
			"node",
			"--subgraph",
			SUBGRAPH,
			"--table",
			TABLE,
			"--url",
			failWebhookUrl,
		]);
		failSubscriptionCreated = true;
		await runCli(cwd, [
			"subscriptions",
			"replay",
			FAIL_SUBSCRIPTION,
			"--from-block",
			String(startBlock),
			"--to-block",
			String(tip),
			"--yes",
		]);
		await waitForOpenCircuit(cwd);

		console.log("Row-positive subscription proof passed");
	} finally {
		console.log("Cleaning up dry-run resources");
		if (failSubscriptionCreated) {
			await runCli(
				cwd,
				["subscriptions", "delete", FAIL_SUBSCRIPTION, "--yes"],
				{
					allowFailure: true,
				},
			);
		}
		if (okSubscriptionCreated) {
			await runCli(cwd, ["subscriptions", "delete", OK_SUBSCRIPTION, "--yes"], {
				allowFailure: true,
			});
		}
		if (subgraphCreated) {
			await runCli(cwd, ["subgraphs", "delete", SUBGRAPH, "--yes", "--force"], {
				allowFailure: true,
			});
		}
		if (instanceCreated) {
			await runCli(cwd, ["instance", "delete", "--yes"], {
				allowFailure: true,
			});
		}
		await deleteProject(projectSlug);
		await rm(cwd, { recursive: true, force: true });
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.stack || err.message : String(err));
	process.exit(1);
});
