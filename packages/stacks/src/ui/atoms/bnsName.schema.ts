import { z } from "zod";

export const BnsNameProps = z.object({
	name: z.string(),
	namespace: z.string(),
	expiresAt: z.string().nullable().optional().describe("ISO-8601 timestamp"),
});

export type BnsNamePropsType = z.infer<typeof BnsNameProps>;
