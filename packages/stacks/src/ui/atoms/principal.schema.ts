import { z } from "zod";

export const PrincipalProps = z.object({
	value: z.string().describe("Standard or contract principal"),
	bns: z.string().nullable().optional(),
	kind: z.enum(["standard", "contract"]).optional(),
});

export type PrincipalPropsType = z.infer<typeof PrincipalProps>;
