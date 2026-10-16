"use client";

import {
	CAP_PRESETS_USD,
	type CapChoice,
	capChoice,
	parseCapInput,
} from "@/lib/billing-view";
import { useId, useState } from "react";

/**
 * Pick the monthly spend cap: `$10 · $25 · $50 · $100 · $ [Other] · None`.
 * One joined group in the shared Choice style, sized to its content. The
 * Other box takes whole dollars and applies on Enter or blur; anything that
 * is not a whole number above zero clears the cap.
 */
export function SpendCapControl({
	capUsd,
	onChange,
}: {
	/** The cap in whole dollars, or null for none. */
	capUsd: number | null;
	onChange: (next: number | null) => void;
}) {
	const name = useId();
	const choice: CapChoice = capChoice(capUsd);
	const [draft, setDraft] = useState<string | null>(null);
	const other = draft ?? (choice === "other" ? String(capUsd) : "");

	function commit() {
		const typed = draft;
		setDraft(null);
		if (typed === null) return;
		const next = parseCapInput(typed);
		if (next === capUsd) return;
		// An empty box next to a preset is just a box nobody used.
		if (typed.trim() === "" && choice !== "other") return;
		onChange(next);
	}

	function pick(next: number | null) {
		setDraft(null);
		if (next !== capUsd) onChange(next);
	}

	return (
		<fieldset className="choice bl-cap">
			<legend className="choice-legend">Spend cap</legend>
			<div className="choice-row">
				{CAP_PRESETS_USD.map((usd) => (
					<label key={usd} className="choice-cell">
						<input
							type="radio"
							name={name}
							value={usd}
							checked={choice === String(usd)}
							onChange={() => pick(usd)}
						/>
						<span>${usd}</span>
					</label>
				))}
				<label className={choice === "other" ? "bl-cap-in on" : "bl-cap-in"}>
					$
					<input
						type="text"
						inputMode="numeric"
						autoComplete="off"
						placeholder="Other"
						aria-label="Custom cap in dollars"
						value={other}
						onChange={(e) => setDraft(e.target.value)}
						onBlur={commit}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								commit();
							}
						}}
					/>
				</label>
				<label className="choice-cell">
					<input
						type="radio"
						name={name}
						value="none"
						checked={choice === "none"}
						onChange={() => pick(null)}
					/>
					<span>None</span>
				</label>
			</div>
		</fieldset>
	);
}
