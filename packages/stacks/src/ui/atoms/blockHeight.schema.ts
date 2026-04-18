import { z } from "zod";

export interface BlockHeightPropsType {
	height: number;
	timestamp?: string | null | undefined;
}

export const BlockHeightProps: z.ZodTypeAny = z.object({
	height: z.number().int().nonnegative(),
	timestamp: z
		.string()
		.nullable()
		.optional()
		.describe("ISO-8601 block timestamp"),
});
