import { z } from "zod";

export interface TokenPropsType {
	symbol: string;
	contract?: string | null | undefined;
	decimals?: number;
}

export const TokenProps: z.ZodTypeAny = z.object({
	symbol: z.string(),
	contract: z
		.string()
		.nullable()
		.optional()
		.describe("SIP-010 contract id (for non-STX tokens)"),
	decimals: z.number().int().min(0).max(18).default(6),
});
