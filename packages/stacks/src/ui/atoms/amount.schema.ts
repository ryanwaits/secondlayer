import { z } from "zod";

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
