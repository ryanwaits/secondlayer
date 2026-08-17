/** @jsxImportSource @opentui/react */
import { type SelectOption, createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { parseInstanceNetwork } from "./instance-init.ts";
import { DEFAULT_IMAGE_OWNER, DEFAULT_IMAGE_TAG } from "./oss-compose.ts";
import {
	DEFAULT_ARCHIVE_MANIFEST,
	type GuardrailPreview,
	type ResolvedSetupConfig,
	SETUP_NODE_MODES,
	type SetupEvent,
	type SetupFlags,
	type SetupStep,
	guardrailPreview,
	parseSetupNodeMode,
	runSetup,
} from "./setup-wizard.ts";

/**
 * The interactive consumer of `lib/setup-wizard.ts`. Every decision made here
 * (network, node mode, manifest source) only ever builds a `ResolvedSetupConfig`
 * — the same shape `resolveNonInteractiveConfig` builds from flags — and then
 * hands it to the same `runSetup()` the non-interactive path calls. Nothing
 * about what setup DOES is decided in this file.
 */

type Stage =
	| "welcome"
	| "network"
	| "nodeMode"
	| "manifestChoice"
	| "manifestInput"
	| "confirm"
	| "running"
	| "done"
	| "error";

const NETWORK_OPTIONS = [
	{
		name: "mainnet",
		description: "Production Stacks chain. Large: plan for hundreds of GB.",
		value: "mainnet",
	},
	{
		name: "testnet",
		description: "Stacks testnet. Small history.",
		value: "testnet",
	},
	{ name: "devnet", description: "Local Clarinet devnet.", value: "devnet" },
];

const NODE_MODE_OPTIONS = SETUP_NODE_MODES.map((mode) => ({
	name: mode,
	description:
		mode === "external"
			? "You run the Stacks node; paste an observer stanza into its Config.toml."
			: mode === "stacks"
				? "You run the Stacks node yourself, no bundled bitcoind (same as external — no bundled-stacks-only profile exists)."
				: "Bundled Stacks node + bitcoind.",
	value: mode,
}));

function formatFloor(f: GuardrailPreview): string {
	return `needs ≥ ${(f.ramFloorMb / 1024).toFixed(0)}GB RAM, ≥ ${f.diskFloorGb}GB disk`;
}

function App({ flags }: { flags: SetupFlags }) {
	const renderer = useRenderer();
	const [stage, setStage] = useState<Stage>("welcome");
	const [network, setNetwork] = useState<
		ResolvedSetupConfig["network"] | undefined
	>(safeParseNetwork(flags.network));
	const [nodeMode, setNodeMode] = useState<
		ResolvedSetupConfig["nodeMode"] | undefined
	>(safeParseNodeMode(flags.nodeMode));
	const [preview, setPreview] = useState<GuardrailPreview>(
		guardrailPreview(NODE_MODE_OPTIONS[0].value, "mainnet"),
	);
	const [against, setAgainst] = useState<string | undefined>(flags.against);
	const [skipBootstrap, setSkipBootstrap] = useState<boolean>(
		!!flags.skipBootstrap,
	);
	const [events, setEvents] = useState<SetupEvent[]>([]);
	const [log, setLog] = useState<string[]>([]);
	const [fatal, setFatal] = useState<string | null>(null);
	const [summary, setSummary] = useState<string | null>(null);
	const started = useRef(false);

	function exit(code: number) {
		renderer.destroy();
		process.exit(code);
	}

	useKeyboard((key) => {
		if (key.eventType === "release") return;
		if (
			(stage === "done" || stage === "error") &&
			(key.name === "q" || key.name === "return")
		) {
			exit(fatal ? 1 : 0);
			return;
		}
		if (
			stage === "welcome" &&
			(key.name === "return" || key.name === "space")
		) {
			advanceFromWelcome();
			return;
		}
		if (stage === "welcome" && key.name === "q") {
			exit(0);
		}
	});

	function advanceFromWelcome() {
		if (!network) {
			setStage("network");
		} else if (!nodeMode) {
			setStage("nodeMode");
		} else if (!against && !skipBootstrap) {
			setStage("manifestChoice");
		} else {
			setStage("confirm");
		}
	}

	function afterNetwork(net: ResolvedSetupConfig["network"]) {
		setNetwork(net);
		if (!nodeMode) setStage("nodeMode");
		else if (!against && !skipBootstrap) setStage("manifestChoice");
		else setStage("confirm");
	}

	function afterNodeMode(mode: ResolvedSetupConfig["nodeMode"]) {
		setNodeMode(mode);
		if (!against && !skipBootstrap) setStage("manifestChoice");
		else setStage("confirm");
	}

	const config: ResolvedSetupConfig | null =
		network && nodeMode
			? {
					network,
					nodeMode,
					apiPort: flags.apiPort ?? "127.0.0.1:3800",
					indexerPort: "127.0.0.1:3700",
					dir: flags.dir ?? process.cwd(),
					against: skipBootstrap ? undefined : against,
					skipBootstrap,
					skipVerify: !!flags.skipVerify,
					yes: false,
					force: !!flags.force,
					owner: flags.owner ?? DEFAULT_IMAGE_OWNER,
					imageTag: flags.imageTag ?? DEFAULT_IMAGE_TAG,
				}
			: null;

	useEffect(() => {
		if (stage !== "running" || started.current || !config) return;
		started.current = true;
		let failed = false;
		runSetup(config, (event) => {
			setEvents((prev) => [...prev, event]);
			if (event.type === "step-log") {
				setLog((prev) => [...prev.slice(-40), event.line]);
			}
			if (event.type === "step-error") {
				failed = true;
				setLog((prev) => [...prev.slice(-40), `ERROR: ${event.message}`]);
			}
		})
			.then((result) => {
				if (!result.ok) {
					setFatal("Setup could not finish — see the log above.");
					setStage("error");
					return;
				}
				setSummary(result.summary ?? null);
				setStage(failed ? "error" : "done");
				if (failed)
					setFatal("Setup finished but at least one step reported an error.");
			})
			.catch((err) => {
				setFatal(err instanceof Error ? err.message : String(err));
				setStage("error");
			});
		// `started` guards this from re-running: `config` is a fresh object every
		// render (built from network/nodeMode/against/skipBootstrap state), but
		// its content is fixed by the time `stage` becomes "running".
	}, [stage, config]);

	return (
		<box style={{ flexDirection: "column", padding: 1 }}>
			<box
				style={{ border: true, borderStyle: "single", borderColor: "#666" }}
				title="secondlayer setup"
			>
				<box style={{ flexDirection: "column", padding: 1 }}>
					{stage === "welcome" && <Welcome />}
					{stage === "network" && (
						<Picker
							title="Network"
							options={NETWORK_OPTIONS}
							onSelect={(value) => afterNetwork(parseInstanceNetwork(value))}
						/>
					)}
					{stage === "nodeMode" && (
						<Picker
							title="Node mode"
							options={NODE_MODE_OPTIONS}
							subtitle={formatFloor(preview)}
							onChange={(value) =>
								setPreview(
									guardrailPreview(
										parseSetupNodeMode(value),
										network ?? "mainnet",
									),
								)
							}
							onSelect={(value) => afterNodeMode(parseSetupNodeMode(value))}
						/>
					)}
					{stage === "manifestChoice" && (
						<Picker
							title="Bootstrap from"
							options={[
								{
									name: "Hosted archive (recommended)",
									description: DEFAULT_ARCHIVE_MANIFEST,
									value: "hosted",
								},
								{
									name: "Custom manifest URL or path",
									description: "Enter your own",
									value: "custom",
								},
								{
									name: "Sync from genesis",
									description: "Skip bootstrap — slower, no download",
									value: "skip",
								},
							]}
							onSelect={(value) => {
								if (value === "hosted") {
									setAgainst(DEFAULT_ARCHIVE_MANIFEST);
									setStage("confirm");
								} else if (value === "skip") {
									setSkipBootstrap(true);
									setStage("confirm");
								} else {
									setStage("manifestInput");
								}
							}}
						/>
					)}
					{stage === "manifestInput" && (
						<ManifestInput
							onSubmit={(value) => {
								setAgainst(value.trim() || DEFAULT_ARCHIVE_MANIFEST);
								setStage("confirm");
							}}
						/>
					)}
					{stage === "confirm" && config && (
						<Confirm config={config} onConfirm={() => setStage("running")} />
					)}
					{stage === "running" && <RunningView events={events} log={log} />}
					{stage === "done" && summary && <Done summary={summary} />}
					{stage === "error" && (
						<ErrorView message={fatal ?? "Setup failed."} log={log} />
					)}
				</box>
			</box>
		</box>
	);
}

function safeParseNetwork(
	value?: string,
): ResolvedSetupConfig["network"] | undefined {
	if (!value) return undefined;
	try {
		return parseInstanceNetwork(value);
	} catch {
		return undefined;
	}
}

function safeParseNodeMode(
	value?: string,
): ResolvedSetupConfig["nodeMode"] | undefined {
	if (!value) return undefined;
	try {
		return parseSetupNodeMode(value);
	} catch {
		return undefined;
	}
}

function Welcome() {
	return (
		<box style={{ flexDirection: "column" }}>
			<text fg="#FFFFFF">Guided self-host setup.</text>
			<text fg="#888">
				{"\n"}This writes secrets, a docker-compose file, and .env into a target
				directory, brings the stack up, and (optionally) restores verified
				history from the archive.
				{"\n\n"}Press Enter to begin, or q to quit.
			</text>
		</box>
	);
}

function Picker({
	title,
	subtitle,
	options,
	onChange,
	onSelect,
}: {
	title: string;
	subtitle?: string;
	options: { name: string; description: string; value: string }[];
	onChange?: (value: string) => void;
	onSelect: (value: string) => void;
}) {
	return (
		<box style={{ flexDirection: "column" }}>
			<text fg="#FFFF00">{title}</text>
			{subtitle && <text fg="#51cf66">{subtitle}</text>}
			<select
				style={{ height: options.length * 2 + 1 }}
				options={options}
				focused
				showDescription
				onChange={(_index: number, option: SelectOption | null) => {
					if (option) onChange?.(String(option.value));
				}}
				onSelect={(_index: number, option: SelectOption | null) => {
					if (option) onSelect(String(option.value));
				}}
			/>
			<text fg="#555">{"\n"}↑↓ to move, enter to choose</text>
		</box>
	);
}

function ManifestInput({ onSubmit }: { onSubmit: (value: string) => void }) {
	return (
		<box style={{ flexDirection: "column" }}>
			<text fg="#FFFF00">Manifest URL or local path</text>
			<text fg="#888">Suggested: {DEFAULT_ARCHIVE_MANIFEST}</text>
			<input
				focused
				placeholder={DEFAULT_ARCHIVE_MANIFEST}
				onSubmit={(value: unknown) => onSubmit(String(value ?? ""))}
			/>
			<text fg="#555">{"\n"}enter to accept (blank = suggested default)</text>
		</box>
	);
}

function Confirm({
	config,
	onConfirm,
}: {
	config: ResolvedSetupConfig;
	onConfirm: () => void;
}) {
	useKeyboard((key) => {
		if (key.eventType === "release") return;
		if (key.name === "return") onConfirm();
	});
	return (
		<box style={{ flexDirection: "column" }}>
			<text fg="#FFFF00">Ready</text>
			<text fg="#CCCCCC">
				{"\n"}network {config.network}
				{"\n"}node mode {config.nodeMode}
				{"\n"}dir {config.dir}
				{"\n"}api port {config.apiPort}
				{"\n"}bootstrap{" "}
				{config.skipBootstrap ? "skip (sync from genesis)" : config.against}
				{"\n"}image ghcr.io/{config.owner}/secondlayer-runtime:{config.imageTag}
			</text>
			<text fg="#51cf66">{"\n"}Press Enter to start.</text>
		</box>
	);
}

const STEP_LABEL: Record<SetupStep, string> = {
	preflight: "Preflight",
	secrets: "Secrets",
	config: "Write config",
	"docker-up": "docker compose up",
	observer: "Observer stanza",
	bootstrap: "Bootstrap",
	verify: "Verify",
	summary: "Summary",
};

function RunningView({ events, log }: { events: SetupEvent[]; log: string[] }) {
	const latestByStep = new Map<SetupStep, SetupEvent>();
	for (const e of events) latestByStep.set(e.step, e);

	return (
		<box style={{ flexDirection: "column" }}>
			{Object.keys(STEP_LABEL).map((step) => {
				const e = latestByStep.get(step as SetupStep);
				const symbol =
					!e || e.type === "step-start"
						? "…"
						: e.type === "step-done"
							? "✓"
							: e.type === "step-skip"
								? "–"
								: e.type === "step-error"
									? "✗"
									: " ";
				const color =
					e?.type === "step-done"
						? "#51cf66"
						: e?.type === "step-error"
							? "#ff6b6b"
							: e?.type === "step-skip"
								? "#888"
								: "#FFD43B";
				return (
					<text key={step} fg={color}>
						{symbol} {STEP_LABEL[step as SetupStep]}
					</text>
				);
			})}
			<box
				style={{
					border: true,
					borderStyle: "single",
					borderColor: "#444",
					marginTop: 1,
					height: 10,
				}}
				title="log"
			>
				<box style={{ flexDirection: "column", padding: 1 }}>
					{log.length === 0 ? (
						<text fg="#555">waiting…</text>
					) : (
						log.map((line, i) => (
							<text key={`${i}:${line}`} fg="#AAAAAA">
								{line}
							</text>
						))
					)}
				</box>
			</box>
		</box>
	);
}

function Done({ summary }: { summary: string }) {
	return (
		<box style={{ flexDirection: "column" }}>
			<text fg="#51cf66">{summary}</text>
			<text fg="#555">{"\n"}press enter or q to exit</text>
		</box>
	);
}

function ErrorView({ message, log }: { message: string; log: string[] }) {
	return (
		<box style={{ flexDirection: "column" }}>
			<text fg="#ff6b6b">{message}</text>
			{log.slice(-10).map((line, i) => (
				<text key={`${i}:${line}`} fg="#888">
					{line}
				</text>
			))}
			<text fg="#555">{"\n"}press enter or q to exit</text>
		</box>
	);
}

export async function runSetupTui(flags: SetupFlags): Promise<void> {
	const renderer = await createCliRenderer({ exitOnCtrlC: true });
	createRoot(renderer).render(<App flags={flags} />);
}
