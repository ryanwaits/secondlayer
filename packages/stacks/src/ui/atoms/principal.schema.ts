import { z } from "zod";

export interface PrincipalPropsType {
	value: string;
	bns?: string | null | undefined;
	kind?: "standard" | "contract" | undefined;
}

export const PrincipalProps: z.ZodTypeAny = z.object({
	value: z.string().describe("Standard or contract principal"),
	bns: z.string().nullable().optional(),
	kind: z.enum(["standard", "contract"]).optional(),
});
