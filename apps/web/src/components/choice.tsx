import type { ReactNode } from "react";

export type ChoiceOption = { value: string; label: string };

type Name =
	| { legend: string; labelledBy?: undefined }
	| { labelledBy: string; legend?: undefined };

type Mode =
	| { defaultValue?: string; value?: undefined; onChange?: undefined }
	| {
			value: string;
			onChange: (value: string) => void;
			defaultValue?: undefined;
	  };

export type ChoiceProps = {
	name: string;
	options: readonly ChoiceOption[];
	size?: "sm";
} & Name &
	Mode;

/**
 * More than three options stack into a column on narrow containers (an inner
 * div is the size container; a fieldset can't be one reliably).
 */
export function Choice({
	name,
	options,
	legend,
	labelledBy,
	defaultValue,
	value,
	onChange,
	size,
}: ChoiceProps): ReactNode {
	return (
		<fieldset
			className={size ? `choice ${size}` : "choice"}
			aria-labelledby={labelledBy}
		>
			{legend && <legend className="choice-legend">{legend}</legend>}
			<div className="choice-wrap">
				<div className="choice-row" data-many={options.length > 3 || undefined}>
					{options.map((o) => (
						<label key={o.value} className="choice-cell">
							<input
								type="radio"
								name={name}
								value={o.value}
								{...(onChange
									? {
											checked: value === o.value,
											onChange: () => onChange(o.value),
										}
									: { defaultChecked: defaultValue === o.value })}
							/>
							<span>{o.label}</span>
						</label>
					))}
				</div>
			</div>
		</fieldset>
	);
}
