import type { ReactNode } from "react";

/**
 * Outcome of a fire-and-forget range operation (replay, backfill).
 *
 * Four states rather than two, because "0 of 0 rows" is a success that reads
 * like a failure. `none` exists so a zero-row outcome can say what was scanned
 * and what to try next, instead of leaving the user unsure whether they picked
 * a bad range.
 */
export type OperationTone = "ok" | "warn" | "none" | "err";

const ICON: Record<OperationTone, string> = {
	ok: "✓",
	warn: "!",
	none: "—",
	err: "×",
};

export function OperationResult({
	tone,
	children,
	hint,
}: {
	tone: OperationTone;
	/** The outcome itself. One sentence, past tense, with the numbers in it. */
	children: ReactNode;
	/** What to do next, or why the outcome is expected. */
	hint?: ReactNode;
}) {
	return (
		// <output> carries an implicit `status` live region, so the result is
		// announced when it replaces a previous one. `.sg-result` sets display,
		// overriding the element's inline default.
		<output className={`sg-result ${tone}`}>
			<span className="ic" aria-hidden="true">
				{ICON[tone]}
			</span>
			<span>
				{children}
				{hint && <span className="sub">{hint}</span>}
			</span>
		</output>
	);
}

/** Block heights are long enough that unseparated digits are hard to compare. */
export function formatBlockRange(from: number, to: number): ReactNode {
	return (
		<span className="mono">
			{from.toLocaleString()}–{to.toLocaleString()}
		</span>
	);
}
