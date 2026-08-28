// Color is gated once at module load: honor FORCE_COLOR / NO_COLOR
// (https://no-color.org), otherwise enable only when stdout is a TTY. Piping
// (`secondlayer … | jq`) sets isTTY false, so data on stdout stays free of ANSI bytes.
const colorEnabled = (() => {
	const { FORCE_COLOR, NO_COLOR } = process.env;
	if (FORCE_COLOR !== undefined && FORCE_COLOR !== "0") return true;
	if (NO_COLOR !== undefined && NO_COLOR !== "") return false;
	return Boolean(process.stdout.isTTY);
})();

// ANSI color codes
const colors = {
	reset: "\x1b[0m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	dim: "\x1b[2m",
	bold: "\x1b[1m",
} as const;
const ANSI_ESCAPE_PATTERN = new RegExp(
	`${String.fromCharCode(27)}\\[[0-9;]*m`,
	"g",
);

function paint(code: string, text: string): string {
	return colorEnabled ? `${code}${text}${colors.reset}` : text;
}

export function red(text: string): string {
	return paint(colors.red, text);
}

export function green(text: string): string {
	return paint(colors.green, text);
}

export function yellow(text: string): string {
	return paint(colors.yellow, text);
}

export function blue(text: string): string {
	return paint(colors.blue, text);
}

export function magenta(text: string): string {
	return paint(colors.magenta, text);
}

export function cyan(text: string): string {
	return paint(colors.cyan, text);
}

export function dim(text: string): string {
	return paint(colors.dim, text);
}

export function bold(text: string): string {
	return paint(colors.bold, text);
}

// Status messages are chrome, not data — they go to stderr so they never
// corrupt piped stdout. `error` was already on stderr.
export function success(message: string): void {
	console.error(green(`✓ ${message}`));
}

export function error(message: string): void {
	const text = message.trim() || "Command failed.";
	console.error(red(`✗ ${text}`));
}

export function warn(message: string): void {
	console.error(yellow(`⚠ ${message}`));
}

export function info(message: string): void {
	console.error(blue(`ℹ ${message}`));
}

// A dim secondary line (cursors, counts, hints) — chrome, so stderr.
export function note(message: string): void {
	console.error(dim(message));
}

/**
 * Print an error followed by an optional actionable next-step hint.
 * The hint is dimmed and prefixed so it reads as guidance, not noise.
 */
export function printError(message: string, opts?: { hint?: string }): void {
	error(message);
	if (opts?.hint) console.error(dim(`  → ${opts.hint}`));
}

/**
 * Write machine-readable data to stdout, newline-terminated, never colored.
 * The single sanctioned path for data that callers may pipe.
 */
export function writeData(value: string): void {
	process.stdout.write(`${value}\n`);
}

interface OutputOptions {
	/** When true, serialize `data` as JSON to stdout and skip the human view. */
	json?: boolean;
	/** The machine-readable value emitted in `--json` mode. */
	data: unknown;
	/** Renders the human-facing view (free to use console/note/table helpers). */
	human: () => void;
}

/**
 * Single owner of the output contract: `--json` emits a stable, full-shape
 * JSON serialization of `data` to stdout; otherwise the human view renders.
 * Keeps the stdout(data)/stderr(chrome) split consistent across commands.
 */
export function output(opts: OutputOptions): void {
	if (opts.json) {
		writeData(JSON.stringify(opts.data, null, 2));
		return;
	}
	opts.human();
}

/**
 * Soft-wrap prose to `width` columns. Only for explanatory sentences — lines
 * holding a command stay unwrapped so they survive a copy-paste.
 */
export function wrapText(text: string, width = 76): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		if (line.length === 0) line = word;
		else if (line.length + 1 + word.length <= width) line += ` ${word}`;
		else {
			lines.push(line);
			line = word;
		}
	}
	if (line.length > 0) lines.push(line);
	return lines;
}

// Strip ANSI codes for length calculation
function stripAnsi(text: string): string {
	return text.replace(ANSI_ESCAPE_PATTERN, "");
}

export function formatTable(headers: string[], rows: string[][]): string {
	// Calculate column widths
	const widths = headers.map((h, i) => {
		const colValues = [h, ...rows.map((r) => r[i] || "")];
		return Math.max(...colValues.map((v) => stripAnsi(v).length));
	});

	// Format header
	const headerRow = headers.map((h, i) => h.padEnd(widths[i] ?? 0)).join("  ");
	const separator = widths.map((w) => "-".repeat(w)).join("  ");

	// Format data rows
	const dataRows = rows.map((row) =>
		row
			.map((cell, i) => {
				const width = widths[i] ?? 0;
				const padding = width - stripAnsi(cell).length;
				return cell + " ".repeat(Math.max(0, padding));
			})
			.join("  "),
	);

	return [headerRow, separator, ...dataRows].join("\n");
}

export function formatKeyValue(pairs: [string, string][]): string {
	const maxKeyLen = Math.max(...pairs.map(([k]) => k.length));
	return pairs
		.map(([key, value]) => `${dim(key.padEnd(maxKeyLen))}  ${value}`)
		.join("\n");
}

/**
 * The one confirmation gate for anything that destroys data or spends money.
 *
 * - `yes` (the `-y/--yes` flag) short-circuits: no prompt, `true`.
 * - Without a TTY on stdin the command exits 1 instead of prompting. An
 *   empty pipe (`echo |`) would otherwise feed a newline into the prompt and
 *   accept it; a closed stdin would hang. Scripts and agents pass `-y`.
 * - The prompt defaults to "no", so Enter alone never destroys anything.
 * - A prompt closed by Ctrl-C exits 1 with the same remedy.
 *
 * Returns `false` when the reader declines; the caller decides what to print
 * and which exit code that is.
 */
export async function confirmDestructive(opts: {
	message: string;
	yes?: boolean;
}): Promise<boolean> {
	if (opts.yes) return true;
	if (!process.stdin.isTTY) {
		error(
			"Interactive prompt unavailable (stdin is not a TTY). Re-run with -y to skip confirmation.",
		);
		process.exit(1);
	}
	const { confirm } = await import("@inquirer/prompts");
	try {
		return await confirm({ message: opts.message, default: false });
	} catch (promptErr) {
		const m =
			promptErr instanceof Error ? promptErr.message : String(promptErr);
		if (m.includes("ExitPromptError") || m.includes("force closed")) {
			error(
				"Interactive prompt unavailable. Re-run with -y to skip confirmation.",
			);
			process.exit(1);
		}
		throw promptErr;
	}
}
