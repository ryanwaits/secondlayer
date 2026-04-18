import { z } from "zod";

export interface BnsNamePropsType {
	name: string;
	namespace: string;
	expiresAt?: string | null | undefined;
}

export const BnsNameProps: z.ZodTypeAny = z.object({
	name: z.string(),
	namespace: z.string(),
	expiresAt: z.string().nullable().optional().describe("ISO-8601 timestamp"),
});
