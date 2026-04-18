import { z } from "zod/v4";

export const AmountProps = z.object({
	microUnits: z
		.string()
		.describe("Amount in micro-units (as string to preserve bigint precision)"),
	decimals: z
		.number()
		.int()
		.min(0)
		.max(18)
		.default(6)
		.describe(
			"Decimal places (6 for STX, 8 for sBTC, varies for SIP-010 tokens)",
		),
	symbol: z.string().default("STX"),
	usdValue: z.number().nullable().optional(),
});

export type AmountPropsType = z.infer<typeof AmountProps>;

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

export function Amount(props: AmountPropsType) {
	const formatted = formatAmount(props.microUnits, props.decimals);
	return (
		<span className="font-mono tabular-nums">
			<span className="font-medium">{formatted}</span>
			<span className="ml-1 text-muted-foreground">{props.symbol}</span>
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

export const AmountComponent = {
	props: AmountProps,
	render: Amount,
} as const;
