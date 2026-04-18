import { z } from "zod";

export interface AddressPropsType {
	value: string;
	bns?: string | null | undefined;
	truncate?: boolean;
}

export const AddressProps: z.ZodTypeAny = z.object({
	value: z.string().describe("Stacks principal (SP…/SM…/ST…)"),
	bns: z.string().nullable().optional().describe("Optional BNS override"),
	truncate: z.boolean().optional().default(true),
});
