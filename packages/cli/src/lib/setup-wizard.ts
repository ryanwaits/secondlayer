/**
 * `secondlayer setup` — the guided self-host onboarding wizard.
 *
 * This file holds every step as a plain, explicit-input function that reports
 * progress through a callback. It is the ONLY place setup logic lives — the
 * TUI (`commands/setup-tui.tsx`) and the non-interactive runner
 * (`commands/setup.ts`) are both thin consumers that call these functions in
 * the same order and render the same `SetupEvent`s differently. Neither one
 * re-implements a step. That split is deliberate: two independently-drifting
 * copies of "how does setup work" is exactly the bug class this file exists to
 * prevent (see the CLI's other credential-resolution helpers for the version
 * of this mistake that has already happened once).
 *
 * What each step does and does not own:
 *   - secrets: generated via `instance-init.ts`'s own functions — never
 *     shelled out to `secondlayer init` as a subprocess.
 *   - docker compose up: this file's own child_process invocation.
 *   - bootstrap / verify: shelled out to the real `secondlayer bootstrap` /
 *     `secondlayer verify` commands — this file does not touch archive
 *     signature checking, resume logic, or exit codes. Re-implementing that
 *     here would be exactly the second implementation this module exists to
 *     avoid.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve as resolvePath } from "node:path";
import type { InstanceNetwork } from "@secondlayer/shared/db/queries/instance";
import { FLOORS, diskFloorGb } from "@secondlayer/shared/runtime";
import type { NodeMode } from "@secondlayer/shared/runtime";
import {
	type InstanceEnv,
	buildInstanceEnv,
	escapeEnvValue,
	loadExistingInstanceEnv,
	parseInstanceNetwork,
	readEnvValue,
} from "./instance-init.ts";
import {
	defaultObserverEndpoint,
	renderObserverStanza,
} from "./observer-stanza.ts";
import {
	DEFAULT_IMAGE_OWNER,
	DEFAULT_IMAGE_TAG,
	buildOssBitcoinConf,
	buildOssCompose,
	buildOssStacksConfigToml,
} from "./oss-compose.ts";

export const SETUP_NODE_MODES = ["external", "stacks", "full"] as const;

/** The official hosted archive's `latest.json` — see docs/archive. */
export const DEFAULT_ARCHIVE_MANIFEST =
	"https://archive.secondlayer.tools/latest.json";

export const SETUP_STEPS = [
	"preflight",
	"secrets",
	"config",
	"docker-up",
	"observer",
	"bootstrap",
	"verify",
	"summary",
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export type SetupEvent =
	| { type: "step-start"; step: SetupStep }
	| { type: "step-log"; step: SetupStep; line: string }
	| { type: "step-done"; step: SetupStep; detail?: string }
	| { type: "step-skip"; step: SetupStep; reason: string }
	| { type: "step-error"; step: SetupStep; message: string };

export type SetupEmit = (event: SetupEvent) => void;

export class MissingSetupFlagError extends Error {
	readonly flag: string;
	constructor(flag: string, message: string) {
		super(message);
		this.name = "MissingSetupFlagError";
		this.flag = flag;
	}
}

export interface SetupFlags {
	network?: string;
	nodeMode?: string;
	apiPort?: string;
	dir?: string;
	against?: string;
	skipBootstrap?: boolean;
	skipVerify?: boolean;
	yes?: boolean;
	force?: boolean;
	owner?: string;
	imageTag?: string;
}

export interface ResolvedSetupConfig {
	network: InstanceNetwork;
	nodeMode: NodeMode;
	apiPort: string;
	indexerPort: string;
	postgresPort: string;
	dir: string;
	against?: string;
	skipBootstrap: boolean;
	skipVerify: boolean;
	yes: boolean;
	force: boolean;
	owner: string;
	imageTag: string;
}

export function parseSetupNodeMode(value: string): NodeMode {
	const mode = value.trim().toLowerCase();
	if ((SETUP_NODE_MODES as readonly string[]).includes(mode)) {
		return mode as NodeMode;
	}
	throw new Error(`node mode must be external, stacks, or full (got ${value})`);
}

/**
 * Non-interactive mode has no safe defaults for the decisions that are
 * irreversible-ish or resource-shaped: network, node mode, and (unless the
 * operator explicitly opts out) the archive to bootstrap from. Every other
 * flag has one. Fails fast, naming exactly the missing flag — an autonomous
 * agent driving this command needs that to recover without a human.
 */
export function resolveNonInteractiveConfig(
	flags: SetupFlags,
): ResolvedSetupConfig {
	if (!flags.network) {
		throw new MissingSetupFlagError(
			"--network",
			"Missing --network <mainnet|testnet|devnet>. Non-interactive setup requires it explicitly — there is no safe default.",
		);
	}
	if (!flags.nodeMode) {
		throw new MissingSetupFlagError(
			"--node-mode",
			"Missing --node-mode <external|stacks|full>. Non-interactive setup requires it explicitly — there is no safe default.",
		);
	}
	if (!flags.against && !flags.skipBootstrap) {
		throw new MissingSetupFlagError(
			"--against",
			"Missing --against <manifest-url>. Pass an archive manifest to bootstrap from, or --skip-bootstrap to sync from genesis instead.",
		);
	}

	const network = parseInstanceNetwork(flags.network);
	const nodeMode = parseSetupNodeMode(flags.nodeMode);
	const dir = resolvePath(flags.dir ?? process.cwd());

	return {
		network,
		nodeMode,
		apiPort: flags.apiPort ?? "127.0.0.1:3800",
		indexerPort: "127.0.0.1:3700",
		postgresPort: "127.0.0.1:5432",
		dir,
		against: flags.against,
		skipBootstrap: !!flags.skipBootstrap,
		skipVerify: !!flags.skipVerify,
		yes: !!flags.yes,
		force: !!flags.force,
		owner: flags.owner ?? DEFAULT_IMAGE_OWNER,
		imageTag: flags.imageTag ?? DEFAULT_IMAGE_TAG,
	};
}

// ---------------------------------------------------------------------------
// Step 1: preflight
// ---------------------------------------------------------------------------

export interface GuardrailPreview {
	ramFloorMb: number;
	diskFloorGb: number;
}

/** The resource floor for a given node mode + network — shown before the
 *  operator commits to a choice, not after. */
export function guardrailPreview(
	nodeMode: NodeMode,
	network: InstanceNetwork,
): GuardrailPreview {
	return {
		ramFloorMb: nodeMode === "full" ? FLOORS.fullRamMb : FLOORS.appRamMb,
		diskFloorGb: diskFloorGb(nodeMode, network),
	};
}

/**
 * OpenTUI's native renderer is Bun-only today — its FFI loader throws
 * "OpenTUI native FFI is not available for this runtime yet" under node.
 * The published CLI runs under node via its shebang (see the note on
 * `checkDocker` below for the same constraint), so `commands/setup.ts` uses
 * this to decide whether to even attempt the OpenTUI wizard versus falling
 * back to an `@inquirer/prompts` flow that drives the same `runSetup` steps.
 */
export function isBunRuntime(): boolean {
	return (
		typeof process !== "undefined" &&
		typeof process.versions === "object" &&
		process.versions !== null &&
		typeof (process.versions as Record<string, string | undefined>).bun ===
			"string"
	);
}

/**
 * child_process (not `Bun.$`, and not `lib/docker.ts`'s `isDockerAvailable`,
 * which is built on `Bun.$`) so this works under both node and bun — the
 * published CLI runs under node via its shebang, where `Bun.$` doesn't exist.
 * Same fix `devnet.ts` already applies for the same reason.
 */
export async function checkDocker(): Promise<boolean> {
	const probe = spawnSync("docker", ["info"], { stdio: "ignore" });
	return !probe.error && probe.status === 0;
}

/** True if `host:port` can be bound right now — i.e. nothing local already
 *  owns it. Used to catch host-port collisions before `docker compose up`
 *  hits them as an opaque "port is already allocated" failure. */
function isPortFree(host: string, port: number): Promise<boolean> {
	return new Promise((resolvePromise) => {
		const srv = createServer();
		srv.once("error", () => resolvePromise(false));
		srv.once("listening", () => srv.close(() => resolvePromise(true)));
		srv.listen(port, host);
	});
}

/** Publish specs in this file are `host:port` (e.g. "127.0.0.1:3800") or a
 *  bare port. `lastIndexOf` rather than `split` so an IPv6 host wouldn't
 *  break this (not used today, but cheap to not paint into a corner). */
function parsePublishSpec(spec: string): { host: string; port: number } {
	const idx = spec.lastIndexOf(":");
	if (idx === -1) return { host: "127.0.0.1", port: Number(spec) };
	return { host: spec.slice(0, idx), port: Number(spec.slice(idx + 1)) };
}

/**
 * Host ports Docker has already published to *some* container, regardless
 * of which host IP they're bound to. This matters because Docker's own NAT
 * allocator refuses to publish a port on 127.0.0.1 if another container
 * already holds it on 0.0.0.0 — but a bare OS socket bind to 127.0.0.1
 * still *succeeds* in that situation (BSD permits a specific-address bind
 * alongside an existing wildcard one), so `isPortFree` alone misses it. A
 * dev box with more than one docker-compose stack running hits this for
 * real, not just in theory. Best-effort: an unreachable/absent docker CLI
 * just yields an empty set, same as the rest of preflight already assumes
 * docker is reachable by this point.
 */
function dockerPublishedHostPorts(): Set<number> {
	const probe = spawnSync("docker", ["ps", "--format", "{{.Ports}}"], {
		encoding: "utf8",
	});
	const ports = new Set<number>();
	if (probe.error || probe.status !== 0 || !probe.stdout) return ports;
	for (const match of probe.stdout.matchAll(/:(\d+)->/g)) {
		ports.add(Number(match[1]));
	}
	return ports;
}

/**
 * Finds a free host port for a publish spec, starting at the requested port
 * and walking upward. Local dev machines routinely already have a Postgres
 * on 5432, or another docker-compose stack already running — failing the
 * whole guided setup over that instead of routing around it would make
 * `secondlayer setup` less guided than the five manual commands it replaced.
 */
export async function resolveAvailablePublishSpec(
	spec: string,
	claimedByDocker: Set<number> = new Set(),
	maxAttempts = 20,
): Promise<{ spec: string; remapped: boolean }> {
	const { host, port } = parsePublishSpec(spec);
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const candidate = port + attempt;
		if (claimedByDocker.has(candidate)) continue;
		if (await isPortFree(host, candidate)) {
			return { spec: `${host}:${candidate}`, remapped: attempt > 0 };
		}
	}
	// Nothing free nearby — hand back the original and let `docker compose
	// up`'s own error surface, rather than silently wandering far from the
	// port the operator asked for.
	return { spec, remapped: false };
}

// ---------------------------------------------------------------------------
// Step 2: secrets
// ---------------------------------------------------------------------------

export interface SetupSecrets {
	instance: InstanceEnv;
	postgresPassword: string;
	bitcoinRpcPassword?: string;
}

function randomHex(bytes: number): string {
	return randomBytes(bytes).toString("hex");
}

/**
 * Idempotent the same way `secondlayer init` is idempotent: an existing
 * `.env` in the target dir seeds `existing`, so re-running `setup` reuses the
 * same token/keys/passwords instead of minting new ones and orphaning
 * whatever already trusts the old values. `--force` (via `existing = {}`)
 * regenerates everything.
 */
export function resolveSecrets(config: {
	dir: string;
	network: InstanceNetwork;
	apiPort: string;
	force: boolean;
}): SetupSecrets {
	const envPath = join(config.dir, ".env");
	const existing =
		config.force || !existsSync(envPath)
			? {}
			: readEnvFile(config.dir, envPath);

	const instance = buildInstanceEnv({
		network: config.network,
		existing: {
			INSTANCE_TOKEN: existing.INSTANCE_TOKEN,
			SECONDLAYER_SECRETS_KEY: existing.SECONDLAYER_SECRETS_KEY,
			STREAMS_SIGNING_PRIVATE_KEY: existing.STREAMS_SIGNING_PRIVATE_KEY,
			SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY:
				existing.SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY,
			SL_API_URL: existing.SL_API_URL,
			SL_API_KEY: existing.SL_API_KEY,
			ARCHIVE_SIGNING_PUBLIC_KEY: existing.ARCHIVE_SIGNING_PUBLIC_KEY,
		},
		apiUrl: `http://${normalizeLoopbackHost(config.apiPort)}`,
	});

	return {
		instance,
		postgresPassword: existing.POSTGRES_PASSWORD || randomHex(24),
		bitcoinRpcPassword: existing.BITCOIN_RPC_PASSWORD || randomHex(24),
	};
}

function normalizeLoopbackHost(apiPort: string): string {
	// apiPort is a publish spec like "127.0.0.1:3800" or "3800" — normalize to
	// something fetch() and the printed API URL can both use.
	return apiPort.includes(":") ? apiPort : `127.0.0.1:${apiPort}`;
}

/** Reads the handful of extra (non-instance-init) keys `setup` also persists
 *  in `.env`, for idempotent re-runs. Uses `instance-init`'s own env-file
 *  reader so quoting/escaping rules stay in one place. */
function readEnvFile(
	dir: string,
	envPath: string,
): Partial<
	Record<
		keyof InstanceEnv | "POSTGRES_PASSWORD" | "BITCOIN_RPC_PASSWORD",
		string | null
	>
> {
	const shared = loadExistingInstanceEnv(dir, ".env");
	return {
		...shared,
		POSTGRES_PASSWORD: readEnvValue(envPath, "POSTGRES_PASSWORD"),
		BITCOIN_RPC_PASSWORD: readEnvValue(envPath, "BITCOIN_RPC_PASSWORD"),
	};
}

// ---------------------------------------------------------------------------
// Step 3: write compose + .env (+ bundled-node config, when applicable)
// ---------------------------------------------------------------------------

export interface WrittenSetupFiles {
	composePath: string;
	envPath: string;
	configTomlPath?: string;
	bitcoinConfPath?: string;
}

function renderSetupEnv(
	config: ResolvedSetupConfig,
	secrets: SetupSecrets,
): string {
	const i = secrets.instance;
	const lines = [
		"# Generated by `secondlayer setup`. Do not commit.",
		`NETWORK=${config.network}`,
		`STACKS_NETWORK=${config.network}`,
		`NODE_MODE=${config.nodeMode}`,
		`API_PORT=${config.apiPort}`,
		`INDEXER_PORT=${config.indexerPort}`,
		"POSTGRES_USER=secondlayer",
		`POSTGRES_PASSWORD=${secrets.postgresPassword}`,
		"POSTGRES_DB=secondlayer",
		`POSTGRES_PORT=${config.postgresPort}`,
		"# The instance credential. The API validates bearer tokens against it,",
		"# and the CLI/SDK/MCP read it first when authenticating.",
		`INSTANCE_TOKEN=${i.INSTANCE_TOKEN}`,
		`SECONDLAYER_SECRETS_KEY=${i.SECONDLAYER_SECRETS_KEY}`,
		`STREAMS_SIGNING_PRIVATE_KEY=${escapeEnvValue(i.STREAMS_SIGNING_PRIVATE_KEY)}`,
		`SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY=${escapeEnvValue(i.SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY)}`,
		`ALLOW_UNSIGNED_WEBHOOKS=${i.ALLOW_UNSIGNED_WEBHOOKS}`,
		"# Legacy alias of INSTANCE_TOKEN, same value.",
		`SL_API_KEY=${i.SL_API_KEY}`,
		`SL_API_URL=${i.SL_API_URL}`,
	];
	if (i.ARCHIVE_SIGNING_PUBLIC_KEY) {
		lines.push(
			`ARCHIVE_SIGNING_PUBLIC_KEY=${escapeEnvValue(i.ARCHIVE_SIGNING_PUBLIC_KEY)}`,
		);
	}
	if (config.nodeMode === "full") {
		lines.push(
			"BITCOIN_RPC_USER=stacks",
			`BITCOIN_RPC_PASSWORD=${secrets.bitcoinRpcPassword}`,
		);
	}
	lines.push("");
	return lines.join("\n");
}

export async function writeSetupFiles(
	config: ResolvedSetupConfig,
	secrets: SetupSecrets,
): Promise<WrittenSetupFiles> {
	const composePath = join(config.dir, "docker-compose.yml");
	const envPath = join(config.dir, ".env");

	await writeFile(
		composePath,
		buildOssCompose({ owner: config.owner, imageTag: config.imageTag }),
	);
	await writeFile(envPath, renderSetupEnv(config, secrets), { mode: 0o600 });

	const result: WrittenSetupFiles = { composePath, envPath };

	// `full` only: no compose profile mounts Config.toml for `stacks` mode
	// anymore — see `composeProfileArgs` — so writing one for it would be
	// dead output nothing reads.
	if (config.nodeMode === "full") {
		const configTomlPath = join(config.dir, "Config.toml");
		await writeFile(
			configTomlPath,
			buildOssStacksConfigToml({
				network: config.network,
				bitcoinRpcPassword: secrets.bitcoinRpcPassword ?? "",
			}),
		);
		result.configTomlPath = configTomlPath;
	}
	if (config.nodeMode === "full") {
		const bitcoinConfPath = join(config.dir, "bitcoin.conf");
		await writeFile(
			bitcoinConfPath,
			buildOssBitcoinConf({ rpcPassword: secrets.bitcoinRpcPassword ?? "" }),
		);
		result.bitcoinConfPath = bitcoinConfPath;
	}
	return result;
}

// ---------------------------------------------------------------------------
// Step 4: docker compose up
// ---------------------------------------------------------------------------

/**
 * `--profile` flag for the chosen node mode — mirrors how `start.ts` derives
 * it from NODE_MODE. `external` adds nothing (default profile only).
 *
 * `stacks` also adds nothing: there is no bundled-stacks-node-only compose
 * profile (a stacks-node needs Bitcoin data from somewhere, and this compose
 * doesn't wire a public RPC default) — `NODE_MODE=stacks` means "I run my
 * own stacks-node, no bundled bitcoind," same as `external` at the compose
 * level. Only `full` bundles a node (stacks-node + bitcoind together).
 */
export function composeProfileArgs(nodeMode: NodeMode): string[] {
	if (nodeMode === "full") return ["--profile", "full-node"];
	return [];
}

export interface SpawnResult {
	code: number;
	stdout: string;
	stderr: string;
}

function runStreaming(
	command: string,
	args: string[],
	opts: {
		cwd?: string;
		onLine?: (line: string, stream: "stdout" | "stderr") => void;
	},
): Promise<SpawnResult> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd: opts.cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const pump = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
			const text = chunk.toString("utf8");
			if (stream === "stdout") stdout += text;
			else stderr += text;
			if (opts.onLine) {
				for (const line of text.split("\n")) {
					if (line.length > 0) opts.onLine(line, stream);
				}
			}
		};
		child.stdout?.on("data", pump("stdout"));
		child.stderr?.on("data", pump("stderr"));
		child.once("error", reject);
		child.once("close", (code) => {
			resolvePromise({ code: code ?? 1, stdout, stderr });
		});
	});
}

export async function dockerComposeUp(
	config: ResolvedSetupConfig,
	files: WrittenSetupFiles,
	onLine?: (line: string, stream: "stdout" | "stderr") => void,
): Promise<SpawnResult> {
	const args = [
		"compose",
		"-f",
		files.composePath,
		"--env-file",
		files.envPath,
		...composeProfileArgs(config.nodeMode),
		"up",
		"-d",
	];
	return runStreaming("docker", args, { cwd: config.dir, onLine });
}

// ---------------------------------------------------------------------------
// Step: health poll
// ---------------------------------------------------------------------------

export async function pollHealth(
	config: ResolvedSetupConfig,
	opts: { timeoutMs?: number; intervalMs?: number; onTick?: () => void } = {},
): Promise<boolean> {
	const timeoutMs = opts.timeoutMs ?? 120_000;
	const intervalMs = opts.intervalMs ?? 2_000;
	const url = `http://${normalizeLoopbackHost(config.apiPort)}/health`;
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
			if (res.ok) return true;
		} catch {
			// keep polling
		}
		opts.onTick?.();
		if (Date.now() >= deadline) return false;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
}

// ---------------------------------------------------------------------------
// Step 5: observer stanza
// ---------------------------------------------------------------------------

export interface ObserverInfo {
	/** false for stacks/full — the node is bundled, there is nothing to paste. */
	applicable: boolean;
	stanza?: string;
	endpoint?: string;
}

export function getObserverInfo(config: ResolvedSetupConfig): ObserverInfo {
	if (config.nodeMode !== "external") {
		return { applicable: false };
	}
	const endpoint = defaultObserverEndpoint(config.network);
	const stanza = renderObserverStanza({
		mode: "indexer",
		endpoint,
		network: config.network,
	});
	return { applicable: true, stanza, endpoint };
}

// ---------------------------------------------------------------------------
// Steps 6-7: bootstrap / verify — shell out to the real commands
// ---------------------------------------------------------------------------

/** `[node, /path/to/cli.js]` (or the bun equivalent) — re-invoking through
 *  this, rather than reimplementing bootstrap/verify, is what keeps signature
 *  verification, resume logic, and exit codes identical to running the
 *  commands by hand. */
function cliEntry(): string[] {
	const entry = process.argv[1];
	if (!entry) {
		throw new Error(
			"Could not resolve the secondlayer CLI entry to shell out to.",
		);
	}
	return [process.execPath, entry];
}

export async function runBootstrap(
	config: ResolvedSetupConfig,
	against: string,
	onLine?: (line: string, stream: "stdout" | "stderr") => void,
): Promise<SpawnResult> {
	const [command, ...prefix] = cliEntry();
	const args = [...prefix, "bootstrap", "--against", against, "--yes"];
	return runStreaming(command, args, { cwd: config.dir, onLine });
}

export async function runVerify(
	config: ResolvedSetupConfig,
	against: string,
	onLine?: (line: string, stream: "stdout" | "stderr") => void,
): Promise<SpawnResult> {
	const [command, ...prefix] = cliEntry();
	const args = [...prefix, "verify", "all", "--against", against];
	return runStreaming(command, args, { cwd: config.dir, onLine });
}

// ---------------------------------------------------------------------------
// Step 8: success summary
// ---------------------------------------------------------------------------

export function buildSuccessSummary(
	config: ResolvedSetupConfig,
	secrets: SetupSecrets,
): string {
	const apiUrl = `http://${normalizeLoopbackHost(config.apiPort)}`;
	const lines = [
		"Secondlayer is up.",
		"",
		`  api        ${apiUrl}`,
		`  network    ${config.network}`,
		`  node mode  ${config.nodeMode}`,
		`  dir        ${config.dir}`,
		"",
		"Export the instance token for writes (reads on loopback need no credential):",
		`  export INSTANCE_TOKEN=${secrets.instance.INSTANCE_TOKEN}`,
		"",
		"Try it:",
		"  secondlayer subgraphs create my-balances --from-contract SP....my-contract",
		"  secondlayer subgraphs deploy subgraphs/my-balances.ts",
		`  curl ${apiUrl}/v1/subgraphs/my-balances/balances`,
		"",
		"Docs: https://secondlayer.tools/docs/self-host",
	];
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Orchestrator — used by both the TUI and the non-interactive runner.
// ---------------------------------------------------------------------------

export interface SetupResult {
	ok: boolean;
	config: ResolvedSetupConfig;
	secrets?: SetupSecrets;
	files?: WrittenSetupFiles;
	observer?: ObserverInfo;
	summary?: string;
}

export async function runSetup(
	initialConfig: ResolvedSetupConfig,
	emit: SetupEmit,
): Promise<SetupResult> {
	// Preflight can route around busy ports (see below), which replaces this
	// with a corrected config every later step reads — a local `let` so that
	// doesn't mean reassigning the function's own parameter.
	let config = initialConfig;

	emit({ type: "step-start", step: "preflight" });
	if (!(await checkDocker())) {
		emit({
			type: "step-error",
			step: "preflight",
			message:
				"Docker isn't reachable. Start Docker Desktop/OrbStack, or install Docker, then re-run.",
		});
		return { ok: false, config };
	}

	// Route around ports that are already taken locally instead of letting
	// `docker compose up` fail opaquely on "port is already allocated" —
	// mainnet/testnet dev boxes commonly already run a local Postgres on
	// 5432. Every step from here on reads the actually-bindable ports.
	const claimedByDocker = dockerPublishedHostPorts();
	const ports = {
		api: await resolveAvailablePublishSpec(config.apiPort, claimedByDocker),
		indexer: await resolveAvailablePublishSpec(
			config.indexerPort,
			claimedByDocker,
		),
		postgres: await resolveAvailablePublishSpec(
			config.postgresPort,
			claimedByDocker,
		),
	};
	config = {
		...config,
		apiPort: ports.api.spec,
		indexerPort: ports.indexer.spec,
		postgresPort: ports.postgres.spec,
	};
	for (const [label, result] of [
		["api", ports.api],
		["indexer", ports.indexer],
		["postgres", ports.postgres],
	] as const) {
		if (result.remapped) {
			emit({
				type: "step-log",
				step: "preflight",
				line: `${label} port was already in use locally, using ${result.spec} instead`,
			});
		}
	}

	const floors = guardrailPreview(config.nodeMode, config.network);
	emit({
		type: "step-done",
		step: "preflight",
		detail: `NODE_MODE=${config.nodeMode} on ${config.network} needs at least ${floors.ramFloorMb}MB RAM and ${floors.diskFloorGb}GB disk.`,
	});

	emit({ type: "step-start", step: "secrets" });
	const secrets = resolveSecrets({
		dir: config.dir,
		network: config.network,
		apiPort: config.apiPort,
		force: config.force,
	});
	emit({ type: "step-done", step: "secrets" });

	emit({ type: "step-start", step: "config" });
	const files = await writeSetupFiles(config, secrets);
	emit({
		type: "step-done",
		step: "config",
		detail: `${files.composePath}, ${files.envPath}`,
	});

	emit({ type: "step-start", step: "docker-up" });
	const up = await dockerComposeUp(config, files, (line) =>
		emit({ type: "step-log", step: "docker-up", line }),
	);
	if (up.code !== 0) {
		emit({
			type: "step-error",
			step: "docker-up",
			message: `docker compose up failed (exit ${up.code}).\n${up.stderr || up.stdout}`,
		});
		return { ok: false, config, secrets, files };
	}
	const healthy = await pollHealth(config, {
		onTick: () =>
			emit({
				type: "step-log",
				step: "docker-up",
				line: "waiting for /health…",
			}),
	});
	if (!healthy) {
		emit({
			type: "step-error",
			step: "docker-up",
			message:
				"Containers started but /health never came up. Check `docker compose logs`.",
		});
		return { ok: false, config, secrets, files };
	}
	emit({ type: "step-done", step: "docker-up" });

	emit({ type: "step-start", step: "observer" });
	const observer = getObserverInfo(config);
	if (observer.applicable && observer.stanza) {
		// The wizard cannot reach across and edit a node it doesn't control —
		// say that plainly rather than pretending this step is automated.
		emit({
			type: "step-log",
			step: "observer",
			line: "ACTION REQUIRED — paste this into your Stacks node's Config.toml:",
		});
		for (const line of observer.stanza.split("\n")) {
			if (line.length > 0) emit({ type: "step-log", step: "observer", line });
		}
		emit({
			type: "step-done",
			step: "observer",
			detail: `endpoint ${observer.endpoint} — see the ACTION REQUIRED lines above`,
		});
	} else {
		emit({
			type: "step-done",
			step: "observer",
			detail: "bundled node — the observer is pre-configured, nothing to paste",
		});
	}

	let bootstrapped = false;
	if (config.skipBootstrap) {
		emit({ type: "step-skip", step: "bootstrap", reason: "--skip-bootstrap" });
	} else if (config.against) {
		emit({ type: "step-start", step: "bootstrap" });
		const res = await runBootstrap(config, config.against, (line) =>
			emit({ type: "step-log", step: "bootstrap", line }),
		);
		if (res.code === 0) {
			bootstrapped = true;
			emit({ type: "step-done", step: "bootstrap" });
		} else {
			emit({
				type: "step-error",
				step: "bootstrap",
				message: `secondlayer bootstrap exited ${res.code}.`,
			});
		}
	}

	if (config.skipVerify) {
		emit({ type: "step-skip", step: "verify", reason: "--skip-verify" });
	} else if (!config.against) {
		emit({
			type: "step-skip",
			step: "verify",
			reason: "no manifest to verify against",
		});
	} else if (!bootstrapped) {
		emit({
			type: "step-skip",
			step: "verify",
			reason: "bootstrap did not run — nothing restored yet to verify",
		});
	} else {
		emit({ type: "step-start", step: "verify" });
		const res = await runVerify(config, config.against, (line) =>
			emit({ type: "step-log", step: "verify", line }),
		);
		if (res.code === 0) {
			emit({ type: "step-done", step: "verify" });
		} else {
			emit({
				type: "step-error",
				step: "verify",
				message: `secondlayer verify exited ${res.code}.`,
			});
		}
	}

	const summary = buildSuccessSummary(config, secrets);
	emit({ type: "step-start", step: "summary" });
	emit({ type: "step-done", step: "summary", detail: summary });

	return { ok: true, config, secrets, files, observer, summary };
}
