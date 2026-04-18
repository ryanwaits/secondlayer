import { z } from "zod";

export interface AmountPropsType {
	microUnits: string;
	decimals?: number;
	symbol?: string;
	usdValue?: number | null | undefined;
}

export const AmountProps: z.ZodTypeAny = z.object({
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
