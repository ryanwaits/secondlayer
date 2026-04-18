import { z } from "zod";

export const TokenProps = z.object({
	symbol: z.string(),
	contract: z
		.string()
		.nullable()
		.optional()
		.describe("SIP-010 contract id (for non-STX tokens)"),
	decimals: z.number().int().min(0).max(18).default(6),
});

export type TokenPropsType = z.infer<typeof TokenProps>;
