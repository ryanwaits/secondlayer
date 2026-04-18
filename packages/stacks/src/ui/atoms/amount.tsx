import type { ReactElement } from "react";
import type { StacksAtom } from "../atom-types.ts";
import { AmountProps, type AmountPropsType } from "./amount.schema.ts";

export { AmountProps, type AmountPropsType };

function formatAmount(microUnits: string, decimals: number): string {
	try {
		const raw = BigInt(microUnits);
		const divisor = 10n ** BigInt(decimals);
		const whole = raw / divisor;
		const fraction = raw % divisor;
		if (fraction === 0n) return whole.toLocaleString();
		const fracStr = fraction
			.toString()
			.padStart(decimals, "0")
			.replace(/0+$/, "");
		return `${whole.toLocaleString()}.${fracStr}`;
	} catch {
		return microUnits;
	}
}

export function Amount(props: AmountPropsType): ReactElement {
	const decimals = props.decimals ?? 6;
	const symbol = props.symbol ?? "STX";
	const formatted = formatAmount(props.microUnits, decimals);
	return (
		<span className="font-mono tabular-nums">
			<span className="font-medium">{formatted}</span>
			<span className="ml-1 text-muted-foreground">{symbol}</span>
			{props.usdValue != null && (
				<span className="ml-2 text-sm text-muted-foreground">
					($
					{props.usdValue.toLocaleString(undefined, {
						maximumFractionDigits: 2,
					})}
					)
				</span>
			)}
		</span>
	);
}

export const AmountComponent: StacksAtom = {
	props: AmountProps,
	render: Amount,
};
