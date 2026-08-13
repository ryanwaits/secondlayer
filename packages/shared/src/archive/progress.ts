/**
 * Progress reporting for multi-hour archive jobs.
 *
 * A job that prints nothing until it finishes is indistinguishable from a hung
 * one. That is not a cosmetic problem: on 2026-08-12 an export ran silently for
 * 2.5 hours and progress had to be inferred by listing partition filenames on
 * disk, and a killed upload left a log whose single line could not distinguish
 * "died immediately" from "died at 90%".
 *
 * Two rules make the output trustworthy:
 *
 *  - **Time-based, not count-based.** Reporting every N items goes quiet for
 *    an hour when items are large and floods when they are small. Reporting
 *    every N seconds behaves the same for a sparse range and a dense one, so
 *    silence always means the same thing: something is wrong.
 *  - **stderr only.** Progress is chrome. Putting it on stdout would corrupt
 *    `--json` output for every caller that pipes it.
 */

export type ProgressReporter = {
	/** Record cumulative progress. Emits at most once per interval. */
	tick: (completed: number, detail?: string) => void;
	/** Emit a final line regardless of interval. */
	finish: (detail?: string) => void;
};

export type ProgressOptions = {
	label: string;
	/** Total units, when known. Enables percentage and ETA. */
	total?: number;
	intervalMs?: number;
	/** Defaults to stderr. Injectable so tests capture without spying. */
	write?: (line: string) => void;
	now?: () => number;
};

const DEFAULT_INTERVAL_MS = 30_000;

export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "unknown";
	if (seconds < 90) return `${Math.round(seconds)}s`;
	if (seconds < 5_400) return `${Math.round(seconds / 60)}m`;
	if (seconds < 172_800) return `${(seconds / 3_600).toFixed(1)}h`;
	return `${(seconds / 86_400).toFixed(1)}d`;
}

export function createProgressReporter(
	options: ProgressOptions,
): ProgressReporter {
	const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
	const now = options.now ?? (() => Date.now());
	const write =
		options.write ?? ((line: string) => process.stderr.write(`${line}\n`));

	const startedAt = now();
	let lastEmit = startedAt;

	function line(completed: number, detail?: string): string {
		const elapsed = (now() - startedAt) / 1000;
		const parts = [`${options.label}:`];

		if (options.total !== undefined && options.total > 0) {
			const pct = Math.floor((completed / options.total) * 100);
			parts.push(`${completed}/${options.total} (${pct}%)`);
			// ETA only once there is a rate to extrapolate from; a prediction made
			// from zero progress is noise dressed as information.
			if (completed > 0 && elapsed > 0) {
				const remaining = ((options.total - completed) / completed) * elapsed;
				parts.push(`eta ${formatDuration(remaining)}`);
			}
		} else {
			parts.push(String(completed));
		}

		parts.push(`elapsed ${formatDuration(elapsed)}`);
		if (detail) parts.push(`· ${detail}`);
		return `  ${parts.join(" ")}`;
	}

	return {
		tick(completed, detail) {
			const current = now();
			if (current - lastEmit < intervalMs) return;
			lastEmit = current;
			write(line(completed, detail));
		},
		finish(detail) {
			lastEmit = now();
			write(line(options.total ?? 0, detail));
		},
	};
}
