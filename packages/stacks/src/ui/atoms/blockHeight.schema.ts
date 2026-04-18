import { z } from "zod";

export const BlockHeightProps = z.object({
	height: z.number().int().nonnegative(),
	timestamp: z
		.string()
		.nullable()
		.optional()
		.describe("ISO-8601 block timestamp"),
});

export type BlockHeightPropsType = z.infer<typeof BlockHeightProps>;
