import type { ReactNode } from "react";

export type AmountOption = { value: string; label: string; caption?: string };

type Name =
	| { legend: string; labelledBy?: undefined }
	| { labelledBy: string; legend?: undefined };

export type AmountPickerProps = {
	name: string;
	options: readonly AmountOption[];
	/** The chosen value; any value not in `options` leaves nothing selected. */
	value: string;
	onChange: (value: string) => void;
} & Name;

/**
 * Pick one amount. Same radio markup as Choice, laid out as boxes with an
 * optional caption under the amount. Selected is a pri tint (wash, 1px pri
 * edge); the solid pri stays the action button's.
 */
export function AmountPicker({
	name,
	options,
	legend,
	labelledBy,
	value,
	onChange,
}: AmountPickerProps): ReactNode {
	return (
		<fieldset className="amount-picker" aria-labelledby={labelledBy}>
			{legend && <legend className="choice-legend">{legend}</legend>}
			<div className="amount-wrap">
				<div className="amount-grid">
					{options.map((o) => (
						<label key={o.value} className="amount-box">
							<input
								type="radio"
								name={name}
								value={o.value}
								checked={value === o.value}
								onChange={() => onChange(o.value)}
							/>
							<span className="amount-main">{o.label}</span>
							{o.caption && <span className="amount-caption">{o.caption}</span>}
						</label>
					))}
				</div>
			</div>
		</fieldset>
	);
}
