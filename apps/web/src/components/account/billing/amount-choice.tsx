"use client";

import { PACKS_USD, isTopupUsd } from "@/lib/account-data";
import { useId, useState } from "react";

const isPack = (n: number) => (PACKS_USD as readonly number[]).includes(n);

/** Whether the Other cell wears the tint: only once what it holds is an
 *  amount the top-up route accepts. While a typed amount is invalid the cell
 *  shows just its focus edge. `draft` is the box's text, null when untouched. */
export function otherCellOn(draft: string | null, value: number): boolean {
	if (draft === null) return !isPack(value);
	return draft !== "" && isTopupUsd(Number(draft));
}

/**
 * Pick a top-up amount: the four packs, then `$ [Other]` for any whole dollar
 * the top-up route accepts. One joined row that spans its column.
 */
export function AmountChoice({
	value,
	onChange,
}: {
	/** Whole dollars. A value outside PACKS_USD shows in the Other box. */
	value: number;
	/** Called with a valid amount, or null while the Other box holds something invalid. */
	onChange: (next: number | null) => void;
}) {
	const name = useId();
	const [draft, setDraft] = useState<string | null>(null);
	const typing = draft !== null && draft !== "";
	const other = draft ?? (isPack(value) ? "" : String(value));
	const otherOn = otherCellOn(draft, value);

	function type(raw: string) {
		const digits = raw.replace(/\D/g, "");
		setDraft(digits);
		if (digits === "") {
			// An empty box next to a picked pack is just a box nobody used.
			if (!isPack(value)) onChange(null);
			return;
		}
		const n = Number(digits);
		onChange(isTopupUsd(n) ? n : null);
	}

	return (
		<fieldset className="choice fill">
			<legend className="choice-legend">Amount</legend>
			<div className="choice-wrap">
				<div className="choice-row">
					{PACKS_USD.map((usd) => (
						<label key={usd} className="choice-cell">
							<input
								type="radio"
								name={name}
								value={usd}
								checked={!typing && !otherOn && value === usd}
								onChange={() => {
									setDraft(null);
									onChange(usd);
								}}
							/>
							<span>${usd}</span>
						</label>
					))}
					<label className={otherOn ? "choice-other on" : "choice-other"}>
						$
						<input
							type="text"
							inputMode="numeric"
							autoComplete="off"
							placeholder="Other"
							aria-label="Other amount in dollars"
							value={other}
							onChange={(e) => type(e.target.value)}
						/>
					</label>
				</div>
			</div>
		</fieldset>
	);
}
