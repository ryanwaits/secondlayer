/** @jsxImportSource @opentui/react */
import {
	CliRenderEvents,
	type SelectOption,
	type ThemeMode,
	createCliRenderer,
} from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
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
 *
 * Palette: this repo's DESIGN.md (§ Terminal palette, § Named rules, §
 * Structural neutrals, and the light/dark crosswalk table) already defines
 * the terminal identity for the whole brand, in both themes — this file
 * reuses those values exactly; it does not invent its own.
 *
 * Dark: window/raise/text-ramp hex values, the Warm-Terminal Rule (text is
 * the warm `#d7d1c9` family, never cool gray), and the One-Accent Rule (teal
 * is the terminal's one accent — "prompt arrows, links" — sunset orange is
 * spent elsewhere and never reused here).
 *
 * Light: this is a REAL terminal (an operator's own emulator), not the
 * marketing site's fixed-dark decorative one, so it has to answer to the
 * operator's actual theme — DESIGN.md's crosswalk table says as much
 * ("a light-theme editor surface is white, not #151515") and gives the exact
 * mapping: `--term-bg` (light) = paper `#ffffff`, `--term-fg` (light) =
 * `ink-hover #1f2228` (not plain `ink` — that's reserved for the brighter,
 * more emphatic tone here, mirroring how dark's `bright` is brighter than
 * its `fg`). Borders on light surfaces are documented as `ink` at 8–10%
 * alpha, explicitly NOT `dove` ("dove is for scrollbar thumbs and inputs").
 * Teal stays the one accent in both themes — it's this tool's own identity,
 * not something that should flip with the operator's terminal background;
 * stated here as a deliberate choice, not an oversight.
 */

const DARK_COLORS = {
	bg: "#151515",
	raise: "#202020",
	fg: "#d7d1c9",
	muted: "#8d867e",
	bright: "#f2ede5",
	accent: "#29c6be",
	success: "#22c55e",
	warning: "#eab308",
	error: "#ef4444",
	// rgba(255,255,255,0.08) from DESIGN.md, expressed as 8-digit hex (the
	// format parseColor actually accepts — it has no rgba() string parser).
	borderIdle: "#FFFFFF14",
	// Semantic colors "paired with 8%-alpha backgrounds; never decorative"
	// per DESIGN.md — same derivation, foreground-over-nothing at 8% alpha.
	successBg: "#22c55e14",
	errorBg: "#ef444414",
} as const;

const LIGHT_COLORS = {
	bg: "#ffffff", // paper
	raise: "#f8f6f2", // card
	fg: "#1f2228", // ink-hover — DESIGN.md's documented light --term-fg
	muted: "#7d8288", // fog — general secondary/UI text
	bright: "#0a0a0a", // ink — more emphatic than ink-hover, mirrors dark's ramp
	accent: "#29c6be", // same teal — this tool's identity, not theme-bound
	success: "#22c55e",
	warning: "#eab308",
	error: "#ef4444",
	// ink/8% — "borders on light surfaces prefer ink/8–ink/10 alpha over dove"
	borderIdle: "#0A0A0A14",
	successBg: "#22c55e14",
	errorBg: "#ef444414",
} as const;

type Palette = Record<keyof typeof DARK_COLORS, string>;

const ColorsContext = createContext<Palette>(DARK_COLORS);

/** OpenTUI queries the real terminal's OSC 10/11 colors and classifies the
 *  result — this is the operator's actual theme, not an inference. Falls
 *  back to dark (DESIGN.md's default terminal identity) until the query
 *  resolves or if the terminal never answers it. */
function useTerminalThemeMode(): ThemeMode {
	const renderer = useRenderer();
	const [mode, setMode] = useState<ThemeMode>(renderer.themeMode ?? "dark");
	useEffect(() => {
		let cancelled = false;
		renderer.waitForThemeMode(500).then((resolved) => {
			if (!cancelled && resolved) setMode(resolved);
		});
		const onThemeMode = (next: ThemeMode) => setMode(next);
		renderer.on(CliRenderEvents.THEME_MODE, onThemeMode);
		return () => {
			cancelled = true;
			renderer.off(CliRenderEvents.THEME_MODE, onThemeMode);
		};
	}, [renderer]);
	return mode;
}

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

// A per-stage opacity crossfade, and a running-view progress-fill bar, were
// both here and got cut, not just left out. Both relied on the same pattern:
// repeated `.add()` calls against one reused `useTimeline()` instance, once
// per unrelated trigger event (once per stage change; once per step
// completing). That pattern reliably broke rendering after the second or
// third call in a real pty test — the timeline instance appears to stop
// ticking new work once its own `loop:false` window elapses, so later
// content rendered blank. Confirmed by removing the crossfade and
// re-running: every stage rendered correctly. The progress-fill bar was cut
// alongside it on the same evidence, even though it happened not to fail in
// that particular run — the run only exercised ~4 of 8 steps before hitting
// the (expected, unrelated) docker-pull failure, the same call-count range
// where the crossfade still appeared fine before breaking. Shipping it
// unverified past that range wasn't worth the risk for a bar that duplicates
// information the step list (✓/✗/spinner per row) already shows. Terminal
// state changes are already instant; losing either loses no information
// (Emil's own rule — cut motion before adding it). The spinner below is
// unaffected — it's a plain `setInterval`, no `useTimeline`/`Timeline.add()`
// involved, and it rendered correctly throughout.

/** Braille spinner for the one step that's actively running — the only
 *  per-frame animation outside the crossfade. Off entirely once nothing in
 *  `events` is mid-flight, so it never runs during a static screen. */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
function useSpinner(active: boolean): string {
	const [frame, setFrame] = useState(0);
	useEffect(() => {
		if (!active) return;
		const id = setInterval(
			() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length),
			80,
		);
		return () => clearInterval(id);
	}, [active]);
	return SPINNER_FRAMES[frame];
}

function App({ flags }: { flags: SetupFlags }) {
	const renderer = useRenderer();
	const themeMode = useTerminalThemeMode();
	const colors = themeMode === "light" ? LIGHT_COLORS : DARK_COLORS;
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
		<ColorsContext.Provider value={colors}>
			<box
				style={{
					border: true,
					borderStyle: "single",
					borderColor: colors.borderIdle,
					backgroundColor: colors.bg,
					padding: 1,
				}}
				title="secondlayer setup"
			>
				<box style={{ flexDirection: "column" }}>
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
		</ColorsContext.Provider>
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
	const colors = useContext(ColorsContext);
	return (
		<box style={{ flexDirection: "column" }}>
			<text fg={colors.bright}>Guided self-host setup.</text>
			<text fg={colors.muted}>
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
	const colors = useContext(ColorsContext);
	return (
		<box style={{ flexDirection: "column" }}>
			<text fg={colors.bright}>{title}</text>
			{subtitle && <text fg={colors.accent}>{subtitle}</text>}
			<select
				style={{ height: options.length * 2 + 1 }}
				options={options}
				focused
				showDescription
				backgroundColor="transparent"
				textColor={colors.fg}
				focusedBackgroundColor={colors.raise}
				focusedTextColor={colors.bright}
				selectedBackgroundColor={colors.raise}
				selectedTextColor={colors.accent}
				descriptionColor={colors.muted}
				selectedDescriptionColor={colors.fg}
				onChange={(_index: number, option: SelectOption | null) => {
					if (option) onChange?.(String(option.value));
				}}
				onSelect={(_index: number, option: SelectOption | null) => {
					if (option) onSelect(String(option.value));
				}}
			/>
			<text fg={colors.muted}>{"\n"}↑↓ to move, enter to choose</text>
		</box>
	);
}

function ManifestInput({ onSubmit }: { onSubmit: (value: string) => void }) {
	const colors = useContext(ColorsContext);
	return (
		<box style={{ flexDirection: "column" }}>
			<text fg={colors.bright}>Manifest URL or local path</text>
			<text fg={colors.muted}>Suggested: {DEFAULT_ARCHIVE_MANIFEST}</text>
			<input
				focused
				placeholder={DEFAULT_ARCHIVE_MANIFEST}
				textColor={colors.fg}
				focusedTextColor={colors.accent}
				placeholderColor={colors.muted}
				onSubmit={(value: unknown) => onSubmit(String(value ?? ""))}
			/>
			<text fg={colors.muted}>
				{"\n"}enter to accept (blank = suggested default)
			</text>
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
	const colors = useContext(ColorsContext);
	useKeyboard((key) => {
		if (key.eventType === "release") return;
		if (key.name === "return") onConfirm();
	});
	return (
		<box style={{ flexDirection: "column" }}>
			<text fg={colors.bright}>Ready</text>
			<text fg={colors.fg}>
				{"\n"}network {config.network}
				{"\n"}node mode {config.nodeMode}
				{"\n"}dir {config.dir}
				{"\n"}api port {config.apiPort}
				{"\n"}bootstrap{" "}
				{config.skipBootstrap ? "skip (sync from genesis)" : config.against}
				{"\n"}image ghcr.io/{config.owner}/secondlayer-runtime:{config.imageTag}
			</text>
			<text fg={colors.accent}>{"\n"}Press Enter to start.</text>
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
const STEP_ORDER = Object.keys(STEP_LABEL) as SetupStep[];

function RunningView({ events, log }: { events: SetupEvent[]; log: string[] }) {
	const colors = useContext(ColorsContext);
	const latestByStep = new Map<SetupStep, SetupEvent>();
	for (const e of events) latestByStep.set(e.step, e);

	const anyActive = STEP_ORDER.some(
		(step) => latestByStep.get(step)?.type === "step-start",
	);
	const spinner = useSpinner(anyActive);

	return (
		<box style={{ flexDirection: "column" }}>
			{STEP_ORDER.map((step) => {
				const e = latestByStep.get(step);
				const active = e?.type === "step-start";
				const symbol = !e
					? "·"
					: active
						? spinner
						: e.type === "step-done"
							? "✓"
							: e.type === "step-skip"
								? "–"
								: e.type === "step-error"
									? "✗"
									: " ";
				const color = active
					? colors.accent
					: e?.type === "step-done"
						? colors.success
						: e?.type === "step-error"
							? colors.error
							: e?.type === "step-skip"
								? colors.muted
								: colors.muted;
				return (
					<text key={step} fg={color}>
						{symbol} {STEP_LABEL[step]}
					</text>
				);
			})}
			<box
				style={{
					border: true,
					borderStyle: "single",
					borderColor: colors.borderIdle,
					marginTop: 1,
					height: 10,
				}}
				title="log"
			>
				<box style={{ flexDirection: "column", padding: 1 }}>
					{log.length === 0 ? (
						<text fg={colors.muted}>waiting…</text>
					) : (
						log.map((line, i) => (
							<text
								key={`${i}:${line}`}
								fg={line.startsWith("ERROR:") ? colors.error : colors.fg}
							>
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
	const colors = useContext(ColorsContext);
	return (
		<box style={{ flexDirection: "column" }}>
			<box style={{ backgroundColor: colors.successBg, padding: 1 }}>
				<text fg={colors.success}>{summary}</text>
			</box>
			<text fg={colors.muted}>{"\n"}press enter or q to exit</text>
		</box>
	);
}

function ErrorView({ message, log }: { message: string; log: string[] }) {
	const colors = useContext(ColorsContext);
	return (
		<box style={{ flexDirection: "column" }}>
			<box style={{ backgroundColor: colors.errorBg, padding: 1 }}>
				<text fg={colors.error}>{message}</text>
			</box>
			{log.slice(-10).map((line, i) => (
				<text key={`${i}:${line}`} fg={colors.muted}>
					{line}
				</text>
			))}
			<text fg={colors.muted}>{"\n"}press enter or q to exit</text>
		</box>
	);
}

/**
 * Resolves once the session genuinely ends, rejects if OpenTUI's renderer
 * hits a render or handler error mid-session — not right after mount, which
 * is all the previous version waited for. That gap is exactly how a crash
 * that happens after the welcome screen (picking a network, submitting the
 * confirm screen, anything mid-interaction) used to skip past
 * `commands/setup.ts`'s catch block entirely and dump a raw stack trace over
 * a half-drawn TUI instead of degrading to the `@inquirer/prompts` fallback.
 */
export async function runSetupTui(flags: SetupFlags): Promise<void> {
	const renderer = await createCliRenderer({ exitOnCtrlC: true });
	createRoot(renderer).render(<App flags={flags} />);

	return new Promise<void>((resolve, reject) => {
		let settled = false;
		const onDestroy = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		const onError = (event: { error?: Error }) => {
			if (settled) return;
			settled = true;
			try {
				renderer.destroy();
			} catch {
				// already tearing down — nothing more to do
			}
			reject(event.error ?? new Error("OpenTUI renderer error"));
		};
		renderer.once(CliRenderEvents.DESTROY, onDestroy);
		renderer.once(CliRenderEvents.RENDER_ERROR, onError);
		renderer.once(CliRenderEvents.HANDLER_ERROR, onError);
	});
}
